import React from "react";

type UrlTransform = (url: string) => string;

// When a `urlTransform` is supplied, apply it to markdown link/image targets
// (`[alt](url)` / `![alt](url)`) so tests can assert the resolved URL — the
// real react-markdown applies `urlTransform` to `href`/`src` during parsing.
const ReactMarkdown = ({
  children,
  urlTransform,
}: {
  children: string;
  urlTransform?: UrlTransform;
}) => {
  const rendered = urlTransform
    ? children.replace(
        /(!?\[[^\]]*\]\()([^)]*)(\))/g,
        (_match, pre: string, url: string, post: string) => `${pre}${urlTransform(url)}${post}`,
      )
    : children;
  return <div data-testid="markdown-content">{rendered}</div>;
};

export default ReactMarkdown;

// Mirrors react-markdown v10's real `defaultUrlTransform`: relative URLs and a
// safe protocol allowlist (http(s), irc(s), mailto, xmpp) pass through; any
// other protocol (e.g. an unresolved `helio://`) is stripped to "".
export function defaultUrlTransform(value: string): string {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    /^(https?|ircs?|mailto|xmpp):/i.test(value.slice(0, colon + 1))
  ) {
    return value;
  }
  return "";
}
