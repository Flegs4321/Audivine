"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./auth/context/AuthProvider";

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto py-4 flex items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Home
            </Link>
            <Link
              href="/recorder"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Record
            </Link>
            <Link
              href="/sermons"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Sermons Library
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Audivine</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.email}</span>
            <button
              onClick={signOut}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-8">Welcome to Audivine</h2>
          <div className="flex flex-col gap-4 items-center">
            <Link
              href="/recorder"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Go to Recorder
            </Link>
            <Link
              href="/sermons"
              className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Go to Sermons Library
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

