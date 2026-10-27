import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDirectory = path.join(frontendDirectory, "dist");
const shell = await readFile(path.join(distDirectory, "index.html"), "utf8");
const publicPages = new Map([
  [
    "about",
    {
      title: "About Infinity House | Addis Ababa Real Estate",
      description:
        "Learn about Infinity House and our real-estate services for buying, selling, renting and managing properties in Addis Ababa, Ethiopia.",
    },
  ],
  [
    "contact",
    {
      title: "Contact Us | Addis Ababa Property Sales & Rent",
      description:
        "Contact Infinity House about houses for sale, apartments for rent and property management in Addis Ababa, Ethiopia. Get in touch with our team.",
    },
  ],
  [
    "property-management",
    {
      title: "Property Management in Addis Ababa | Infinity House",
      description:
        "Explore property management services in Addis Ababa with Infinity House. Contact our team to discuss managing and marketing your property.",
    },
  ],
]);
const privateRoutes = [
  "accept-invitation",
  "account",
  "admin",
  "admin/login",
  "agent-onboarding",
  "dashboard",
  "favorites",
  "forgot-password",
  "login",
  "management/agents",
  "management/branding",
  "management/brokerage",
  "management/listings",
  "management/listings/new",
  "management/locations",
  "management/public-accounts",
  "management/public-pages",
  "management/submissions",
  "management/viewing-requests",
  "my-submissions",
  "register",
  "reset-password",
  "settings",
  "submissions/new",
  "verify-email",
  "viewing-requests",
  "viewing-requests/new",
  "viewing-requests/status",
];

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function renderPage({ title, description, robots, canonical }) {
  const headTags = [
    `<meta name="description" content="${escapeAttribute(description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg" sizes="any" />',
    canonical ? `<link rel="canonical" href="${canonical}" />` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return shell
    .replace(/\s*<meta\s+name="description"[^>]*\/?\s*>/i, "")
    .replace(/\s*<meta\s+name="robots"[^>]*\/?\s*>/i, "")
    .replace(/\s*<link\s+rel="canonical"[^>]*\/?\s*>/i, "")
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace("</head>", `    ${headTags}\n  </head>`);
}

const rootPage = renderPage({
  title: "Infinity House",
  description:
    "Find a place to rent or buy in Ethiopia. Explore real property listings and request a viewing.",
  robots: "index, follow",
  canonical: "https://infinityhouseproperties.com/",
});
await writeFile(path.join(distDirectory, "index.html"), rootPage);

for (const [route, metadata] of publicPages) {
  const directory = path.join(distDirectory, route);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.html"),
    renderPage({
      ...metadata,
      robots: "index, follow",
      canonical: `https://infinityhouseproperties.com/${route}/`,
    }),
  );
}

for (const route of privateRoutes) {
  const directory = path.join(distDirectory, route);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.html"),
    renderPage({
      title: "Infinity House",
      description:
        "Find houses and apartments for sale or rent with Infinity House.",
      robots: "noindex, follow",
    }),
  );
}

await writeFile(
  path.join(distDirectory, "private-route-fallback.html"),
  renderPage({
    title: "Infinity House",
    description:
      "Find houses and apartments for sale or rent with Infinity House.",
    robots: "noindex, follow",
  }),
);
