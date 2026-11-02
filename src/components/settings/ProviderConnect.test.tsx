import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FormField, IntegrationInfo } from "@opencode/client";
import { ProviderConnect } from "./ProviderConnect";

const refresh = async () => undefined;
const noop = () => {};

/** Rows as a live 2.2.5 server sent them (see `lib/integrations.test.ts`). */
const openai: IntegrationInfo = {
  id: "openai",
  name: "OpenAI",
  methods: [
    { type: "key" },
    { type: "env", names: ["OPENAI_API_KEY"] },
    { id: "chatgpt-token-sharing", type: "oauth", label: "Sign in with ChatGPT" },
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
            { value: "github.com", label: "GitHub.com" },
            { value: "enterprise", label: "GitHub Enterprise" },
          ],
        },
        {
          key: "enterpriseUrl",
          title: "Enter your GitHub Enterprise URL or domain",
          required: true,
          when: [{ key: "deploymentType", op: "eq", value: "enterprise" }],
          type: "string",
        },
      ],
    },
  ],
  connections: [],
};

const vertexForm: [FormField, ...FormField[]] = [
  { key: "project", title: "Google Cloud project", required: true, type: "string" },
  { key: "location", title: "Location", required: true, type: "string", default: "global" },
];

const vertex: IntegrationInfo = {
  id: "google-vertex",
  name: "Vertex",
  methods: [
    { type: "key" },
    {
      id: "google-adc",
      type: "external",
      label: "Google Cloud credentials (gcloud auth or environment)",
      form: vertexForm,
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

const render = (info: IntegrationInfo, remote = false) => renderToStaticMarkup(<ProviderConnect info={info} remote={remote} refresh={refresh} onDone={noop} />);

describe("the panel under a provider row", () => {
  test("a provider with several ways in shows each one, and the key form first", () => {
    const html = render(openai);
    expect(html).toContain("Sign in with ChatGPT");
    expect(html).toContain("Codex device code (legacy)");
    expect(html).toContain("API key");
    expect(html).toContain("Save");
    expect(html).toContain('type="password"');
  });

  test("env vars are offered as a quiet alternative", () => {
    expect(render(openai)).toContain("or set OPENAI_API_KEY on the agent machine");
  });

  test("Copilot's form comes with its deployment choice, and the URL field waits for enterprise", () => {
    const html = render(copilot);
    expect(html).toContain("Login with GitHub Copilot");
    expect(html).toContain("Select GitHub deployment type");
    expect(html).toContain("GitHub.com");
    expect(html).toContain("GitHub Enterprise");
    expect(html).not.toContain("Enter your GitHub Enterprise URL or domain");
  });

  test("a credential already on the machine is a choice when the provider also takes a key", () => {
    const html = render(vertex);
    expect(html).toContain("Google Cloud credentials (gcloud auth or environment)");
    expect(html).toContain("Checks this machine");
    // The key method comes first, so that's the form shown until the other is picked.
    expect(html).toContain('type="password"');
  });

  test("a machine credential's form starts from the server's defaults", () => {
    const html = render({
      id: "example",
      name: "Example",
      methods: [{ id: "adc", type: "external", label: "Machine credentials", form: vertexForm }],
      connections: [],
    });
    expect(html).toContain("Google Cloud project");
    expect(html).toContain('value="global"');
    expect(html).toContain("Looks for credentials already on the agent machine.");
  });

  test("a provider with one way in skips the picker and says what checking means", () => {
    const html = render(claudeAgent);
    expect(html).toContain("Claude Code login (claude auth login)");
    expect(html).toContain("Check");
    expect(html).not.toContain("Checks this machine");
  });

  test("a connection that still needs a sign-in is listed with its remove button", () => {
    const html = render({
      ...claudeAgent,
      connections: [{ type: "credential", id: "cred_1", label: "Claude Agent", method: "external", status: { status: "needs_auth", message: "Claude Code is not logged in." } }],
    });
    expect(html).toContain("Claude Agent");
    expect(html).toContain("Remove");
  });
});
