import { redirect } from "next/navigation";
import ManualPsetEditor from "./ManualPsetEditor";
import { getUserPsetDrafts } from "@/lib/queries/user-pset-drafts-server";
import { DEV_EDITOR_EMAIL } from "@/lib/queries/user-pset-drafts-shared";

export default async function AccountPage() {
  const { userId, email, canEdit, drafts } = await getUserPsetDrafts();

  if (!userId) redirect("/login");

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <section className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#750014]">
          Account Workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900">
          Manual PDF to problem set editor
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">
          Build private pset drafts directly in the browser, edit each problem by
          hand, and keep the solution alongside the prompt. This editor is
          currently enabled only for the dev account at{" "}
          <span className="font-medium text-zinc-900">{DEV_EDITOR_EMAIL}</span>.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Signed in as {email ?? "unknown user"}.
        </p>
      </section>

      <div className="mt-8">
        <ManualPsetEditor canEdit={canEdit} initialDrafts={drafts} />
      </div>
    </main>
  );
}
