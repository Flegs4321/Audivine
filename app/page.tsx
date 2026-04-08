"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./auth/context/AuthProvider";
import Header from "./components/Header";

export default function Home() {
  const router = useRouter();
  const { user, signOut, loading } = useAuth();

  // Clear hash fragments after email confirmation (Supabase adds these to the URL)
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      // Check if hash contains auth tokens (from email confirmation)
      const hash = window.location.hash;
      if (hash.includes("access_token") || hash.includes("type=recovery")) {
        // Let Supabase handle the hash, then clean up the URL after a delay
        // This gives Supabase time to process the tokens from the hash
        const cleanup = setTimeout(() => {
          if (window.location.hash) {
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search
            );
          }
        }, 2000); // Increased delay to ensure Supabase processes the tokens

        return () => clearTimeout(cleanup);
      }
    }
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="text-sm text-slate-600">Loading…</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header />

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:py-24">
        <div className="w-full max-w-lg border border-slate-200/80 bg-white p-10 shadow-card sm:rounded-2xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-900">
            Welcome to Audivine
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600">
            Record services and manage sermon audio in one place.
          </p>
          <div className="mt-10 flex flex-col gap-3">
            <Link
              href="/recorder"
              className="inline-flex w-full items-center justify-center rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
            >
              Open recorder
            </Link>
            <Link
              href="/sermons"
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Sermons library
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

