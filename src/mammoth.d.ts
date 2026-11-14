declare module "mammoth/mammoth.browser" {
  type Image = { contentType: string; read(encoding: "base64"): Promise<string> };
  type Options = { convertImage?: unknown };
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Options): Promise<{ value: string }>;
  export const images: {
    imgElement(convert: (image: Image) => Promise<{ src: string }>): unknown;
  };
}
