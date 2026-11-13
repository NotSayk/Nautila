import { describe, expect, it } from "vitest";
import { citeLabel, parseBibtex, shortAuthors } from "./refs";

const BIB = `
@comment{ignoré}
@article{einstein1905,
  author = {Einstein, Albert},
  title = {Zur {E}lektrodynamik bewegter K{\\"o}rper},
  year = 1905,
  journal = "Annalen der Physik"
}

@book{knuth84, author = "Donald E. Knuth and Leslie Lamport and Someone Else", title = {The {\\TeX}book}, date = {1984-01-01} }
`;

describe("bibtex", () => {
  it("lit les entrées, leurs champs et ignore les commentaires", () => {
    const refs = parseBibtex(BIB);
    expect(refs.map((r) => r.key)).toEqual(["einstein1905", "knuth84"]);
    expect(refs[0]).toMatchObject({ author: "Einstein, Albert", year: "1905" });
    expect(refs[0].title).toContain("Elektrodynamik");
    expect(refs[1].year).toBe("1984");
    expect(refs[1].bibtex.startsWith("@book{knuth84")).toBe(true);
  });

  it("abrège les auteurs", () => {
    expect(shortAuthors("Einstein, Albert")).toBe("Einstein");
    expect(shortAuthors("Marie Curie and Pierre Curie")).toBe("Curie et Curie");
    expect(shortAuthors("Donald E. Knuth and Leslie Lamport and Someone Else")).toBe("Knuth et al.");
    expect(citeLabel({ key: "k", title: "", author: "", year: "", bibtex: "" })).toBe("k");
  });
});
