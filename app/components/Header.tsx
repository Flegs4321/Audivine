"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth/context/AuthProvider";

interface UserSettings {
  church_logo_url?: string | null;
  church_name?: string | null;
}

const navInactive =
  "rounded-lg border border-transparent px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900";
const navActive =
  "rounded-lg border border-teal-600 bg-teal-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700";

function navClass(pathname: string, href: string): string {
  const isHome = href === "/";
  const active = isHome
    ? pathname === "/" || pathname === ""
    : pathname === href || pathname.startsWith(`${href}/`);
  return active ? navActive : navInactive;
}

export default function Header() {
  const pathname = usePathname() || "/";
  const { user, signOut, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({});
  const [logoKey, setLogoKey] = useState(0);

  useEffect(() => {
    if (user) {
      loadSettings();

      const handleFocus = () => {
        loadSettings();
      };

      const handleVisibilityChange = () => {
        if (!document.hidden) {
          loadSettings();
        }
      };

      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      const { supabase } = await import("@/lib/supabase/client");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      const response = await fetch("/api/settings", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          const newLogoUrl = data.settings.church_logo_url;
          const oldLogoUrl = settings.church_logo_url;

          if (newLogoUrl && newLogoUrl !== oldLogoUrl) {
            setLogoKey((prev) => prev + 1);
          }

          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  };

  if (authLoading) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 shadow-soft backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <Link href="/" className="shrink-0">
            <span className="text-xl font-semibold tracking-tight text-slate-900">
              Audivine
            </span>
          </Link>

          <div className="flex min-w-[12rem] items-center gap-2 sm:min-w-[16rem]">
            {settings.church_logo_url ? (
              <img
                src={`${settings.church_logo_url}?v=${logoKey}`}
                alt={settings.church_name || "Church logo"}
                className="h-10 w-10 shrink-0 rounded-lg border border-slate-200/80 bg-white object-contain p-0.5 shadow-sm"
                key={`${settings.church_logo_url}-${logoKey}`}
                onError={() => {
                  console.error("Logo image failed to load, reloading settings...");
                  loadSettings();
                }}
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg border border-slate-200/80 bg-slate-50" />
            )}
            <span className="hidden max-w-[14rem] truncate text-sm font-medium text-slate-700 sm:inline md:max-w-xs">
              {settings.church_name || " "}
            </span>
          </div>

          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className={navClass(pathname, "/")}
              aria-current={pathname === "/" || pathname === "" ? "page" : undefined}
            >
              Home
            </Link>
            <Link
              href="/recorder"
              className={navClass(pathname, "/recorder")}
              aria-current={pathname.startsWith("/recorder") ? "page" : undefined}
            >
              Record
            </Link>
            <Link
              href="/sermons"
              className={navClass(pathname, "/sermons")}
              aria-current={pathname.startsWith("/sermons") ? "page" : undefined}
            >
              Sermons
            </Link>
            <Link
              href="/settings"
              className={navClass(pathname, "/settings")}
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            >
              Settings
            </Link>
          </nav>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3">
          {user && (
            <>
              <span className="hidden max-w-[200px] truncate text-xs text-slate-500 sm:inline md:max-w-xs">
                {user.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                Log out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
