/**
 * An inline <script> that runs once, during HTML parsing. From the Next guide
 * "Preventing flash before hydration": React warns when a component renders a
 * <script> on the client, so the client copy is text/plain (inert) and
 * suppressHydrationWarning accepts the type difference.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
