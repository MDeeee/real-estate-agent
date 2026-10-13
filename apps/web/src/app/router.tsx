import { createBrowserRouter, type RouteObject } from "react-router";
import { HomePage } from "./home-page";
import { RootLayout } from "./layouts/root-layout";
import { RouteError } from "./layouts/route-error";
import { SiteLayout } from "./layouts/site-layout";

/**
 * The admin area is a separate chunk: visitors of the public page never
 * download it.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        element: <SiteLayout />,
        children: [{ index: true, element: <HomePage /> }],
      },
      {
        path: "admin",
        children: [
          {
            path: "login",
            lazy: async () => ({
              Component: (await import("@/features/admin/auth/login-page"))
                .LoginPage,
            }),
          },
          {
            lazy: async () => ({
              Component: (await import("@/features/admin/auth/require-admin"))
                .RequireAdmin,
            }),
            children: [
              {
                lazy: async () => ({
                  Component: (await import("@/features/admin/admin-layout"))
                    .AdminLayout,
                }),
                children: [
                  {
                    index: true,
                    lazy: async () => ({
                      Component: (await import("@/features/admin/admin-page"))
                        .AdminPage,
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
      // Anything else is a 404 inside the app shell.
      { path: "*", loader: () => { throw new Response("Not Found", { status: 404 }); } },
    ],
  },
];

export const router = createBrowserRouter(routes);
