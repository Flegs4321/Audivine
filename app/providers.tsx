"use client";

import { ReactNode } from "react";
import { AuthProvider } from "./auth/context/AuthProvider";

export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

