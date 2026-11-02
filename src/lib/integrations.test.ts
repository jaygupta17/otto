import { describe, expect, test } from "bun:test";
import type { FormField, IntegrationInfo } from "@opencode/client";
import {
  attemptNote,
  attemptState,
  codeFromInstructions,
  connectMethods,
  connectionPending,
  connectionSummary,
  defaultAnswers,
  envNames,
  finishesOnAgentMachine,
  isDeviceLike,
  isRemoteUrl,
  methodKindLabel,
  methodLabel,
  methodVerb,
  missingRequired,
  payloadAnswers,
  shouldPoll,
  visibleFields,
} from "./integrations";

/**
 * Rows shaped like a live OpenCode 2.2.5 `/api/integration` answer. The form
 * details (Copilot's two fields, Vertex's `global` default, the console's
 * hidden server) are the server's own.
 */
const openai: IntegrationInfo = {
  id: "openai",
  name: "OpenAI",
  methods: [
    { type: "key" },
    { type: "env", names: ["OPENAI_API_KEY"] },
    { id: "chatgpt-token-sharing", type: "oauth", label: "Sign in with ChatGPT" },
    { id: "chatgpt-browser", type: "oauth", label: "Codex browser (legacy)" },
    { id: "chatgpt-headless", type: "oauth", label: "Codex device code (legacy)" },
  ],
  connections: [],
};

const copilot: IntegrationInfo = {
  id: "github-copilot",
  name: "GitHub Copilot",
  methods: [
    { type: "env", names: ["GITHUB_TOKEN"] },
    {
      id: "device",
      type: "oauth",
      label: "Login with GitHub Copilot",
      form: [
        {
          key: "deploymentType",
          title: "Select GitHub deployment type",
          required: true,
          type: "string",
          options: [
            { value: "github.com", label: "GitHub.com", description: "Public" },
            { value: "enterprise", label: "GitHub Enterprise", description: "Data residency or self-hosted" },
          ],
        },
        {
          key: "enterpriseUrl",
          title: "Enter your GitHub Enterprise URL or domain",
          required: true,
          when: [{ key: "deploymentType", op: "eq", value: "enterprise" }],
          type: "string",
          placeholder: "company.ghe.com or https://company.ghe.com",
        },
      ],
    },
  ],
  connections: [],
};

const vertex: IntegrationInfo = {
  id: "google-vertex",
  name: "Vertex",
  methods: [
    { type: "key" },
    { type: "env", names: ["GOOGLE_VERTEX_API_KEY"] },
    {
      id: "google-adc",
      type: "external",
      label: "Google Cloud credentials (gcloud auth or environment)",
      form: [
        { key: "project", title: "Google Cloud project", description: "No projects found in your gcloud configuration.", required: true, type: "string", minLength: 1, pattern: "\\S", placeholder: "Project ID", options: [], custom: true },
        { key: "location", title: "Location", description: "global serves the most models.", required: true, type: "string", minLength: 1, pattern: "\\S", placeholder: "Location", default: "global", options: [], custom: true },
      ],
    },
  ],
  connections: [],
};

const claudeAgent: IntegrationInfo = {
  id: "claude-agent",
  name: "Claude Agent",
  methods: [{ id: "claude-login", type: "external", label: "Claude Code login (claude auth login)" }],
  connections: [],
};

/** No live integration offers one today; the shape is the server's. */
const commandRow: IntegrationInfo = {
  id: "example",
  name: "Example",
  methods: [{ id: "cli-login", type: "command", label: "Sign in with the CLI", command: ["example", "auth", "login"] }],
  connections: [],
};

const consoleRow: IntegrationInfo = {
  id: "opencode",
  name: "OpenCode",
  methods: [
    { type: "key", label: "API key (service account)" },
    { type: "env", names: ["OPENCODE_API_KEY"] },
    { id: "device", type: "oauth", label: "OpenCode Console account", form: [{ key: "server", hidden: true, type: "string", format: "uri", default: "https://opencode.ai/console" }] },
  ],
  connections: [],
};

describe("which methods a provider offers", () => {
  test("env names are advice, not a method", () => {
    expect(connectMethods(openai).map((m) => m.type)).toEqual(["key", "oauth", "oauth", "oauth"]);
    expect(envNames(openai)).toEqual(["OPENAI_API_KEY"]);
    expect(connectMethods({ ...openai, methods: [{ type: "env", names: ["A"] }] })).toEqual([]);
  });

  test("a provider whose only way in is a login on the machine still appears", () => {
    expect(connectMethods(claudeAgent)).toHaveLength(1);
    expect(methodLabel(connectMethods(claudeAgent)[0])).toBe("Claude Code login (claude auth login)");
    expect(methodVerb(connectMethods(claudeAgent)[0])).toBe("Check");
  });

  test("keys without a server label are called what they are, keys with one keep it", () => {
    expect(methodLabel(connectMethods(openai)[0])).toBe("API key");
    expect(methodLabel(connectMethods(consoleRow)[0])).toBe("API key (service account)");
  });

  test("each kind gets its own verb and quiet label", () => {
    const [key, signIn] = [connectMethods(openai)[0], connectMethods(openai)[1]];
    const check = connectMethods(claudeAgent)[0];
    expect([methodVerb(key), methodVerb(signIn), methodVerb(check)]).toEqual(["Save", "Sign in", "Check"]);
    expect([methodKindLabel(key), methodKindLabel(signIn), methodKindLabel(check)]).toEqual(["API key", "Sign in", "Checks this machine"]);
  });

  test("command methods say what they will run", () => {
    const m = connectMethods(commandRow)[0];
    expect(methodLabel(m)).toBe("Sign in with the CLI");
    expect(methodVerb(m)).toBe("Run");
    expect(methodKindLabel(m)).toBe("Runs a command");
    expect(isDeviceLike(m)).toBe(false);
    expect(m.type === "command" && m.command.join(" ")).toBe("example auth login");
  });

  test("device-code methods are the ones that work from anywhere", () => {
    const oauth = connectMethods(openai).filter((m) => m.type === "oauth");
    expect(oauth.map(isDeviceLike)).toEqual([false, false, true]);
    expect(connectMethods(copilot).filter(isDeviceLike)).toHaveLength(1);
  });
});

describe("form answers", () => {
  const copilotFields = copilot.methods.find((m) => m.type === "oauth")!.form as FormField[];
  const vertexFields = vertex.methods.find((m) => m.type === "external")!.form as FormField[];

  test("defaults come from the server, hidden fields included", () => {
    expect(defaultAnswers(vertexFields)).toEqual({ location: "global" });
    expect(defaultAnswers(consoleRow.methods.find((m) => m.type === "oauth")!.form as FormField[])).toEqual({ server: "https://opencode.ai/console" });
  });

  test("a follow-up field only shows once its answer means something", () => {
    const empty = defaultAnswers(copilotFields);
    expect(visibleFields(copilotFields, empty).map((f) => f.key)).toEqual(["deploymentType"]);
    expect(visibleFields(copilotFields, { deploymentType: "github.com" }).map((f) => f.key)).toEqual(["deploymentType"]);
    expect(visibleFields(copilotFields, { deploymentType: "enterprise" }).map((f) => f.key)).toEqual(["deploymentType", "enterpriseUrl"]);
  });

  test("a required field that's still empty holds the button back", () => {
    expect(missingRequired(copilotFields, {}).map((f) => f.key)).toEqual(["deploymentType"]);
    expect(missingRequired(copilotFields, { deploymentType: "github.com" })).toEqual([]);
    expect(missingRequired(copilotFields, { deploymentType: "enterprise" }).map((f) => f.key)).toEqual(["enterpriseUrl"]);
    expect(missingRequired(vertexFields, { location: "global" }).map((f) => f.key)).toEqual(["project"]);
    expect(missingRequired(vertexFields, { project: "  ", location: "global" }).map((f) => f.key)).toEqual(["project"]);
  });

  test("what gets sent: numbers as numbers, blanks and hidden conditionals left out, defaults kept", () => {
    const fields: FormField[] = [
      { key: "count", type: "integer", minimum: 1 },
      { key: "ratio", type: "number" },
      { key: "note", type: "string" },
      { key: "flag", type: "boolean", default: false },
      { key: "server", type: "string", hidden: true, default: "https://opencode.ai/console" },
      { key: "follow", type: "string", required: true, when: [{ key: "flag", op: "eq", value: true }] },
    ];
    expect(payloadAnswers(fields, { count: "3", ratio: "0.5", note: "  ", flag: false, server: "https://opencode.ai/console" })).toEqual({
      count: 3,
      ratio: 0.5,
      flag: false,
      server: "https://opencode.ai/console",
    });
    expect(payloadAnswers(fields, { count: "3", flag: true, follow: "yes" })).toMatchObject({ follow: "yes" });
  });
});

describe("a code the server put in its instructions", () => {
  test("pulls the code out", () => {
    expect(codeFromInstructions("Enter code: VHMW-P6K3A")).toBe("VHMW-P6K3A");
    expect(codeFromInstructions("Enter code: 3758-1155")).toBe("3758-1155");
    expect(codeFromInstructions("Open the page and enter code ABCD")).toBe("ABCD");
  });

  test("says nothing when there is no code", () => {
    expect(codeFromInstructions("Complete authorization in your browser. This window will close automatically.")).toBeNull();
    expect(codeFromInstructions("")).toBeNull();
    expect(codeFromInstructions(null)).toBeNull();
  });
});

describe("whether a sign-in can finish away from the agent machine", () => {
  test("a browser flow's callback is loopback", () => {
    const url = "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A38629%2Fauth%2Fcallback&scope=openid";
    expect(finishesOnAgentMachine(url)).toBe(true);
    expect(finishesOnAgentMachine("http://127.0.0.1:4096/auth/callback?code=abc")).toBe(true);
  });

  test("device-code flows open a public page", () => {
    expect(finishesOnAgentMachine("https://auth.openai.com/codex/device")).toBe(false);
    expect(finishesOnAgentMachine("https://github.com/login/device")).toBe(false);
    expect(finishesOnAgentMachine(null)).toBe(false);
    expect(finishesOnAgentMachine("not a url")).toBe(false);
  });

  test("a workspace is remote when its server isn't this machine", () => {
    expect(isRemoteUrl("http://127.0.0.1:4096")).toBe(false);
    expect(isRemoteUrl("http://localhost:4096")).toBe(false);
    expect(isRemoteUrl("https://otto-abc.xyz.on.boat.dev")).toBe(true);
    expect(isRemoteUrl("nonsense")).toBe(true);
  });
});

describe("an attempt's state", () => {
  const time = { created: 1, expires: 2 };

  test("only a pending attempt is polled again", () => {
    expect(shouldPoll(null)).toBe(true);
    expect(shouldPoll({ status: "pending", time })).toBe(true);
    expect(shouldPoll({ status: "complete", time })).toBe(false);
    expect(shouldPoll({ status: "failed", message: "No", time })).toBe(false);
    expect(shouldPoll({ status: "expired", time })).toBe(false);
  });

  test("the server's own words explain a failure", () => {
    expect(attemptNote({ status: "failed", message: "Token exchange failed", time })).toBe("Token exchange failed");
    expect(attemptNote({ status: "expired", time })).toContain("expired");
    expect(attemptNote({ status: "complete", time })).toBe("Signed in.");
    expect(attemptNote({ status: "pending", time })).toBeNull();
    expect(attemptState({ status: "complete", time })).toBe("complete");
  });
});

describe("what the server says is connected", () => {
  test("a credential can exist and still need a sign-in", () => {
    const state = connectionSummary({
      ...claudeAgent,
      connections: [{ type: "credential", id: "cred_1", label: "Claude Agent", method: "external", status: { status: "needs_auth", message: "Claude Code is not logged in. Run `claude auth login` in a terminal." } }],
    });
    expect(state.connected).toBe(true);
    expect(state.needsAuth).toContain("claude auth login");
    expect(state.removable).toEqual(["cred_1"]);
  });

  test("an env var is a connection but not something Otto can remove", () => {
    const state = connectionSummary({ ...openai, connections: [{ type: "env", name: "OPENAI_API_KEY" }] });
    expect(state).toEqual({ connected: true, needsAuth: null, removable: [] });
  });

  test("a freshly recorded machine credential has no verdict yet", () => {
    const recorded = { ...claudeAgent, connections: [{ type: "credential" as const, id: "cred_1", label: "Claude Agent", method: "external" as const }] };
    expect(connectionPending(recorded)).toBe(true);
    expect(connectionSummary(recorded)).toEqual({ connected: true, needsAuth: null, removable: ["cred_1"] });
    expect(connectionPending({ ...recorded, connections: [{ ...recorded.connections[0], status: { status: "needs_auth" as const, message: "Not logged in." } }] })).toBe(false);
    expect(connectionPending(openai)).toBe(false);
  });

  test("nothing recorded reads as nothing", () => {
    expect(connectionSummary(openai)).toEqual({ connected: false, needsAuth: null, removable: [] });
  });
});
