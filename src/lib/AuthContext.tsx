"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authFetch } from "@/lib/authFetch";

const isDev = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";

// Only import Amplify/Cognito in production
let signIn: Function, signUp: Function, signOut: Function, getCurrentUser: Function, fetchUserAttributes: Function, confirmSignUp: Function;
if (!isDev) {
  import("aws-amplify/auth").then((mod) => {
    signIn = mod.signIn;
    signUp = mod.signUp;
    signOut = mod.signOut;
    getCurrentUser = mod.getCurrentUser;
    fetchUserAttributes = mod.fetchUserAttributes;
    confirmSignUp = mod.confirmSignUp;
  });
  import("@/lib/amplifyConfig");
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  siteRole: "ADMIN" | "USER";
  createdAt: Date;
}

interface AuthContextValue {
  user: AppUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<{ needsConfirmation: boolean }>;
  confirmAccount: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function cognitoUserToAppUser(): Promise<AppUser | null> {
  // Dev mode: auto-authenticate as dev user
  if (isDev) {
    return {
      id: "dev-local-user",
      name: "Dev Player",
      email: "dev@flickpick.local",
      siteRole: "ADMIN",
      createdAt: new Date(),
    };
  }

  try {
    const cognitoUser = await getCurrentUser();
    const attributes = await fetchUserAttributes();

    const res = await authFetch("/api/auth/sync", {
      method: "POST",
      body: JSON.stringify({
        cognitoId: cognitoUser.userId,
        email: attributes.email,
        name: attributes.name || attributes.email,
      }),
    });
    const { user: dbUser } = await res.json();

    return {
      id: dbUser?.id || cognitoUser.userId,
      name: dbUser?.name || attributes.name || attributes.email || "Unknown",
      email: dbUser?.email || attributes.email || "",
      siteRole: (dbUser?.siteRole === "ADMIN" ? "ADMIN" : "USER") as "ADMIN" | "USER",
      createdAt: dbUser?.createdAt ? new Date(dbUser.createdAt) : new Date(),
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    cognitoUserToAppUser()
      .then((u) => setUser(u))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    try { await signOut(); } catch { /* ignore */ }
    await signIn({ username: email, password });
    const u = await cognitoUserToAppUser();
    setUser(u);
  };

  const signup = async (email: string, password: string, name: string) => {
    const result = await signUp({
      username: email,
      password,
      options: { userAttributes: { name, email } },
    });
    const needsConfirmation = result.nextStep?.signUpStep === "CONFIRM_SIGN_UP";
    return { needsConfirmation };
  };

  const confirmAccount = async (email: string, code: string) => {
    await confirmSignUp({ username: email, confirmationCode: code });
  };

  const logout = async () => {
    await signOut();
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, isLoading, login, signup, confirmAccount, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
