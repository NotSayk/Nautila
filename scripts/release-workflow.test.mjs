import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Garde-fous du workflow de publication, qui manipule la clé de signature des mises à jour.
const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const steps = workflow.split(/\n\s*- (?=name:|uses:|run:)/).slice(1);

describe("workflow de publication", () => {
  it("épingle chaque action par empreinte de commit", () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("ne laisse pas le jeton GitHub dans le dépôt cloné", () => {
    const checkout = steps.find((s) => s.includes("actions/checkout@"));
    expect(checkout).toMatch(/persist-credentials:\s*false/);
  });

  it("ne donne la clé de signature qu'à l'étape de construction", () => {
    const withKey = steps.filter((s) => /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\./.test(s));
    expect(withKey).toHaveLength(1);
    expect(withKey[0]).toContain("tauri-apps/tauri-action@");
  });
});
