import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BREADCRUMB_LINK_ACTIVE_OPTIONS, type NavSection } from "@/lib/nav";

/**
 * "AI Command Center /" before the h1: a link when the section has a page, muted text when not.
 * Moved out of app-shell.tsx unchanged (C25) so it can be rendered in a test without the sidebar;
 * the only change is exact active matching (Eng QC S4). TanStack Link adds aria-current="page"
 * whenever its own matching says active, and by default it prefix-matches, so the section link was
 * current on every page under it.
 */
export function PageSection({ section }: { section: NavSection }) {
  return (
    <Breadcrumb className="hidden shrink-0 sm:flex">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="text-sm text-muted-foreground">
          {section.to ? (
            <BreadcrumbLink asChild className="hover:text-foreground">
              <Link to={section.to} activeOptions={BREADCRUMB_LINK_ACTIVE_OPTIONS}>
                {section.label}
              </Link>
            </BreadcrumbLink>
          ) : (
            <span>{section.label}</span>
          )}
        </BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
