import React from "react";

const ReactMarkdown = ({ children }: { children: string }) => (
  <div data-testid="markdown-content">{children}</div>
);

export default ReactMarkdown;
