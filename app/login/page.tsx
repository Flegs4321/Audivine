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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {isSignUp ? "Create your account" : "Sign in to Audivine"}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
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
                  className="font-medium text-blue-600 hover:text-blue-500"
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
                  className="font-medium text-blue-600 hover:text-blue-500"
                >
                  create a new account
                </button>
              </>
            )}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="rounded-md shadow-sm -space-y-px">
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
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
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
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${
                  isSignUp ? "rounded-none" : "rounded-b-md"
                } focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
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
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Confirm Password"
                />
              </div>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}

