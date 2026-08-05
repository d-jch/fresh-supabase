import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>fresh-2.3.3-tailwind</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
