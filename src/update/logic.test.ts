import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, progressPercent, shouldOffer } from "./logic";

describe("compareVersions", () => {
  it("compare numériquement, pas comme du texte", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.5", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("ignore le préfixe v et les métadonnées de build", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0+abc", "1.0.0")).toBe(0);
  });

  it("place les préversions avant la version finale", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
  });

  it("tolère une version illisible sans lever d'erreur", () => {
    expect(compareVersions("n'importe quoi", "1.0.0")).toBe(0);
  });
});

describe("isNewer et shouldOffer", () => {
  it("n'est vrai que pour une version strictement plus récente", () => {
    expect(isNewer("0.3.0", "0.2.5")).toBe(true);
    expect(isNewer("0.2.5", "0.2.5")).toBe(false);
    expect(isNewer("0.2.4", "0.2.5")).toBe(false);
  });

  it("ne repropose pas la version écartée, mais propose la suivante", () => {
    expect(shouldOffer("0.3.0", null)).toBe(true);
    expect(shouldOffer("0.3.0", "0.3.0")).toBe(false);
    expect(shouldOffer("0.3.1", "0.3.0")).toBe(true);
    expect(shouldOffer(null, null)).toBe(false);
  });
});

describe("progressPercent", () => {
  it("calcule le pourcentage borné", () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(0, 200)).toBe(0);
  });

  it("renvoie null quand la taille est inconnue", () => {
    expect(progressPercent(10, null)).toBeNull();
    expect(progressPercent(10, 0)).toBeNull();
  });
});
