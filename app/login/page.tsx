"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth/context/AuthProvider";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signIn, signUp, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);

  // Redirect to home if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      const redirectTo = searchParams.get("redirect") || "/";
      router.push(redirectTo);
    }
  }, [user, router, searchParams, authLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate password match for signup
    if (isSignUp && password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    // Validate password length
    if (isSignUp && password.length < 6) {
      setError("Password must be at least 6 characters long");
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        const { error, data } = await signUp(email, password);
        
        if (error) {
          // Check for specific error cases
          if (error.message?.includes("already registered") || 
              error.message?.includes("already exists") ||
              error.message?.includes("User already registered") ||
              error.status === 422) {
            setError("An account with this email already exists. Please sign in instead.");
            setIsSignUp(false); // Switch to sign in view
          } else {
            setError(error.message || "An error occurred during signup");
          }
          setLoading(false);
          return;
        }

        // Check if session was created (user auto-signed in)
        // If email confirmation is required, data.session will be null
        if (data?.session) {
          // User is automatically signed in - redirect immediately
          const redirectTo = searchParams.get("redirect") || "/";
          router.push(redirectTo);
          router.refresh();
          setLoading(false);
        } else {
          // Email confirmation required
          setError("Please check your email to confirm your account, then sign in.");
          setIsSignUp(false); // Switch to sign in view
          setPassword("");
          setConfirmPassword("");
        }
      } else {
        const { error } = await signIn(email, password);
        
        if (error) {
          setError(error.message);
          setLoading(false);
        } else {
          // The useEffect hook will handle redirect when user state updates
          setLoading(false);
          // Clear form
          setEmail("");
          setPassword("");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-900">
            {isSignUp ? "Create your account" : "Sign in to Audivine"}
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600">
            {isSignUp ? (
              <>
                Or{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setConfirmPassword("");
                    setError(null);
                  }}
                  className="font-medium text-teal-700 hover:text-teal-600"
                >
                  sign in to your existing account
                </button>
              </>
            ) : (
              <>
                Or{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(true);
                    setConfirmPassword("");
                    setError(null);
                  }}
                  className="font-medium text-teal-700 hover:text-teal-600"
                >
                  create a new account
                </button>
              </>
            )}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="-space-y-px overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="relative block w-full appearance-none rounded-none border-0 border-b border-slate-200 px-3 py-3 text-slate-900 placeholder-slate-400 focus:z-10 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`relative block w-full appearance-none border-0 px-3 py-3 text-slate-900 placeholder-slate-400 focus:z-10 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 sm:text-sm ${
                  isSignUp ? "rounded-none border-b border-slate-200" : "rounded-b-xl"
                }`}
                placeholder="Password"
              />
            </div>
            {isSignUp && (
              <div>
                <label htmlFor="confirmPassword" className="sr-only">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="relative block w-full appearance-none rounded-b-xl border-0 px-3 py-3 text-slate-900 placeholder-slate-400 focus:z-10 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 sm:text-sm"
                  placeholder="Confirm Password"
                />
              </div>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-xl border border-transparent bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Loading..." : isSignUp ? "Sign up" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="text-sm text-slate-600">Loading…</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}

