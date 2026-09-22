"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, findUserByName, verifyPassword } from "@/lib/auth";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/rate-limit";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name || !password) return { error: "Renseigne ton nom et ton mot de passe." };
  if (isLockedOut(name))
    return { error: "Trop de tentatives. Réessaie dans quelques minutes." };

  const user = findUserByName(name);

  // On vérifie le hash même quand l'utilisateur n'existe pas, sinon le temps
  // de réponse révèle quels noms sont valides.
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(
        "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHlzYWx0eXNhbHQ$0nCPnZKp0m1UEcqCUXBUyhLcCUJEIWqAtLYqZ5DwmSg",
        password,
      ).catch(() => false);

  if (!user || !ok) {
    recordFailure(name);
    return { error: "Nom ou mot de passe incorrect." };
  }

  clearFailures(name);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
