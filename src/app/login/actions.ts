"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, findUserByName, verifyPassword } from "@/lib/auth";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/rate-limit";

/** `name` revient avec l'erreur pour que le formulaire le garde affiché. */
export type LoginState = { error?: string; name?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name || !password) return { error: "Renseigne ton nom et ton mot de passe.", name };
  // Bornes larges : aucun nom ni mot de passe réel ne les atteint, et elles
  // évitent de hacher un mégaoctet à chaque tentative anonyme.
  if (name.length > 80 || password.length > 200)
    return { error: "Nom ou mot de passe incorrect." };
  if (isLockedOut(name))
    return { error: "Trop de tentatives. Réessaie dans quelques minutes.", name };

  const user = findUserByName(name);

  // On vérifie le hash même quand l'utilisateur n'existe pas, sinon le temps
  // de réponse révèle quels noms sont valides.
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(
        "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHlzYWx0eXNhbHQ$0nCPnZKp0m1UEcqCUXBUyhLcCUJEIWqAtLYqZ5DwmSg",
        password,
      );

  if (!user || !ok) {
    recordFailure(name);
    return { error: "Nom ou mot de passe incorrect.", name };
  }

  clearFailures(name);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
