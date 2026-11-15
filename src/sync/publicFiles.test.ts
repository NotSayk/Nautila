import { describe, expect, it } from "vitest";
import { publicFileUrl } from "./publicFiles";

const ID = "ABCDEFGHIJKLMNOPQRSTUV";
const O = "https://notes.example";

describe("fichiers d'une page publique", () => {
  it("sert les fichiers de la page par le serveur", () => {
    expect(publicFileUrl(O, ID, "nautila-file:aaaa-1")).toBe(`${O}/api/public/${ID}/file/aaaa-1`);
    expect(publicFileUrl(O, `${ID}\\delete`, "nautila-file:aaaa-1")).toBe("");
  });

  it("ne charge une image d'un autre site qu'à la demande du lecteur", () => {
    expect(publicFileUrl(O, ID, "https://pisteur.example/pixel.png")).toBe("");
    expect(publicFileUrl(O, ID, "https://pisteur.example/pixel.png", true)).toBe("https://pisteur.example/pixel.png");
    expect(publicFileUrl(O, ID, "data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("refuse les adresses actives", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "data:image/svg+xml,<svg>"])
      expect(publicFileUrl(O, ID, url, true)).toBe("");
  });
});
