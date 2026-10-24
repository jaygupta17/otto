package dev.jaygupta.otto.share

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.core.content.IntentCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/** Bigger files aren't copied; the app says they're too big to attach. */
private const val MAX_BYTES = 25L * 1024 * 1024

/**
 * What another app shares with Otto (text, a link, files): copied into the
 * cache as it arrives, then handed to the web side once (`take`). A `shared`
 * event says something is waiting while the app is already open.
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    private val lock = Object()
    private var pending: JSObject? = null
    private var copying = 0
    private val waiting = mutableListOf<Invoke>()

    override fun load(webView: WebView) {
        super.load(webView)
        receive(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        receive(intent)
    }

    @Command
    fun take(invoke: Invoke) {
        synchronized(lock) {
            // Still copying: answer once it's done rather than with nothing.
            if (copying > 0) {
                waiting.add(invoke)
                return
            }
            val out = pending ?: JSObject()
            pending = null
            invoke.resolve(out)
        }
    }

    private fun receive(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return
        val uris: List<Uri> =
            if (action == Intent.ACTION_SEND) listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            else IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()
        val type = intent.type
        // Handled: a recreated activity mustn't share it again.
        intent.action = Intent.ACTION_MAIN
        synchronized(lock) { copying++ }
        Thread {
            val files = JSArray()
            try {
                // Only the latest share is kept; earlier copies go.
                val root = File(activity.cacheDir, "shared")
                root.deleteRecursively()
                val dir = File(root, System.currentTimeMillis().toString()).apply { mkdirs() }
                val taken = mutableSetOf<String>()
                for (uri in uris) copy(uri, dir, taken, type)?.let { files.put(it) }
            } catch (_: Exception) {
            }
            val out = JSObject()
            text?.let { out.put("text", it) }
            subject?.let { out.put("subject", it) }
            out.put("files", files)
            val ready = synchronized(lock) {
                copying--
                if (waiting.isNotEmpty() && copying == 0) {
                    waiting.toList().also { waiting.clear() }
                } else {
                    pending = out
                    emptyList()
                }
            }
            // A waiting `take` gets it; otherwise tell the page there's something to take.
            ready.forEachIndexed { i, invoke -> invoke.resolve(if (i == 0) out else JSObject()) }
            if (ready.isEmpty()) activity.runOnUiThread { trigger("shared", JSObject()) }
        }.start()
    }

    /** One shared item into the cache: its name, type and size, and its path unless it's too big. */
    private fun copy(uri: Uri, dir: File, taken: MutableSet<String>, fallback: String?): JSObject? {
        val resolver = activity.contentResolver
        var name: String? = null
        var size = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                    val s = c.getColumnIndex(OpenableColumns.SIZE)
                    if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                }
            }
        } catch (_: Exception) {
        }
        val mime = resolver.getType(uri) ?: fallback?.takeUnless { it.contains('*') }
        val file = File(dir, unique((name ?: uri.lastPathSegment ?: "shared").substringAfterLast('/').ifBlank { "shared" }, taken))
        val out = JSObject()
        out.put("name", file.name)
        mime?.let { out.put("mime", it) }
        if (size > MAX_BYTES) {
            out.put("size", size)
            return out
        }
        try {
            val input = resolver.openInputStream(uri) ?: return null
            input.use { i -> file.outputStream().use { o -> i.copyTo(o) } }
        } catch (_: Exception) {
            file.delete()
            return null
        }
        out.put("size", file.length())
        if (file.length() <= MAX_BYTES) out.put("path", file.absolutePath) else file.delete()
        return out
    }

    private fun unique(name: String, taken: MutableSet<String>): String {
        var n = name
        if (n in taken) {
            val dot = name.lastIndexOf('.')
            val (stem, ext) = if (dot > 0) name.substring(0, dot) to name.substring(dot) else name to ""
            var i = 2
            while ("$stem ($i)$ext" in taken) i++
            n = "$stem ($i)$ext"
        }
        taken.add(n)
        return n
    }
}
