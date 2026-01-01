"use client";

import Link from "next/link";
import { useAuth } from "./auth/context/AuthProvider";

export default function Home() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto py-4 flex items-center justify-between gap-4 px-6">
          <h1 className="text-3xl font-bold text-gray-900">Audivine</h1>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-gray-600">{user.email}</span>
                <button
                  onClick={signOut}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Login
              </Link>
            )}
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

