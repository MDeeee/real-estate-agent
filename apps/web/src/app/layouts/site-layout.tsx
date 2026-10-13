import { Outlet } from "react-router";
import { SiteHeader } from "./site-header";

/** The public pages: the site header above the page. */
export function SiteLayout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  );
}
