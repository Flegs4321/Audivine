"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../auth/context/AuthProvider";

interface UserSettings {
  church_logo_url?: string | null;
  church_name?: string | null;
}

export default function Header() {
  const { user, signOut, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({});
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      setLoadingSettings(true);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLoadingSettings(false);
        return;
      }

      const response = await fetch("/api/settings", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setLoadingSettings(false);
    }
  };

  if (authLoading) {
    return null;
  }

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto py-4 flex items-center justify-between gap-4 pl-0 pr-6">
        <div className="flex items-center gap-4">
          {/* Audivine branding - far left corner */}
          <h1 className="text-3xl font-bold text-gray-900 -ml-24 mr-6">Audivine</h1>
          
          {/* Church Logo and Name */}
          <div className="flex items-center">
            {settings.church_logo_url && (
              <img
                src={settings.church_logo_url}
                alt={settings.church_name || "Church logo"}
                className="h-12 w-12 object-contain rounded mr-2"
              />
            )}
            {settings.church_name && (
              <h2 className="text-xl font-semibold text-gray-900 mr-6">
                {settings.church_name}
              </h2>
            )}
          </div>
          
          {/* Navigation Links */}
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
          <Link
            href="/settings"
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <>
              <span className="text-sm text-gray-600">{user.email}</span>
              <button
                onClick={signOut}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

