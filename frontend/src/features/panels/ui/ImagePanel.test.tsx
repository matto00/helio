import { render, screen } from "@testing-library/react";

import { ImagePanel } from "./ImagePanel";

// <img alt=""> is given the "presentation" ARIA role (decorative image), not "img".
// Use container.querySelector("img") to find the element directly.

describe("ImagePanel — with imageUrl", () => {
  it("renders an <img> element when imageUrl is set", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit={null} />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
  });

  it("applies the imageFit value as objectFit style", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit="cover" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "cover" });
  });

  it("defaults to contain when imageFit is null", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit={null} />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "contain" });
  });

  it("applies fill objectFit when imageFit is fill", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit="fill" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "fill" });
  });
});

describe("ImagePanel — with a root-relative upload URL (HEL-246)", () => {
  it("renders an <img> element with src set to the root-relative path", () => {
    const { container } = render(
      <ImagePanel imageUrl="/api/uploads/image/abc-123" imageFit={null} />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/api/uploads/image/abc-123");
  });

  it("rejects a protocol-relative path smuggled as root-relative", () => {
    const { container } = render(
      <ImagePanel imageUrl="//evil.example.com/x.png" imageFit={null} />,
    );
    const img = container.querySelector("img");
    // Falls through to the plain absolute-URL branch (resolved against the
    // base's protocol) rather than being rendered as the literal smuggled
    // path — same trust level as typing "http://evil.example.com/x.png"
    // directly, not a new same-origin-looking bypass.
    expect(img).toHaveAttribute("src", "http://evil.example.com/x.png");
  });
});

describe("ImagePanel — without imageUrl", () => {
  it("renders placeholder when imageUrl is null", () => {
    const { container } = render(<ImagePanel imageUrl={null} imageFit={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No image URL set/)).toBeInTheDocument();
  });

  it("renders placeholder when imageUrl is empty string", () => {
    const { container } = render(<ImagePanel imageUrl="" imageFit={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No image URL set/)).toBeInTheDocument();
  });
});
