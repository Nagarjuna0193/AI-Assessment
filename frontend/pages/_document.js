import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Every page here is private (invite links carry a token, the
            dashboard holds candidate data) — keep it all out of search. */}
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#4f46e5" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
