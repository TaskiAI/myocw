"use client";

import { useMemo, useState } from "react";
import MathText from "@/app/components/MathText";
import {
  createUserPsetDraft,
  deleteUserPsetDraft,
  updateUserPsetDraft,
} from "@/lib/queries/user-pset-drafts";
import type {
  ManualPsetProblem,
  UserPsetDraft,
  UserPsetDraftInput,
} from "@/lib/types/manual-pset";

type StatusTone = "muted" | "success" | "error";

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

interface EditableDraft extends UserPsetDraft {
  localId: string;
  isNew: boolean;
}

interface EditorState {
  drafts: EditableDraft[];
  selectedLocalId: string;
  savedSnapshots: Record<string, string>;
}

const inputClassName =
  "w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#750014] focus:outline-none focus:ring-4 focus:ring-[#750014]/10 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const textAreaClassName = `${inputClassName} min-h-[140px] resize-y`;

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createProblem(index: number): ManualPsetProblem {
  return {
    id: createId("problem"),
    label: `Problem ${index + 1}`,
    questionText: "",
    solutionText: "",
  };
}

function createBlankDraft(): EditableDraft {
  const now = new Date().toISOString();
  return {
    id: -1,
    localId: createId("draft"),
    isNew: true,
    user_id: "",
    title: "Untitled problem set",
    source_pdf_label: null,
    source_pdf_url: null,
    notes: null,
    problems: [createProblem(0)],
    created_at: now,
    updated_at: now,
  };
}

function toEditableDraft(draft: UserPsetDraft, localId = `draft-${draft.id}`): EditableDraft {
  return {
    ...draft,
    localId,
    isNew: false,
  };
}

function toDraftInput(draft: EditableDraft): UserPsetDraftInput {
  return {
    title: draft.title,
    source_pdf_label: draft.source_pdf_label,
    source_pdf_url: draft.source_pdf_url,
    notes: draft.notes,
    problems: draft.problems,
  };
}

function serializeDraft(draft: EditableDraft): string {
  return JSON.stringify(toDraftInput(draft));
}

function createInitialState(initialDrafts: UserPsetDraft[]): EditorState {
  if (initialDrafts.length === 0) {
    const blank = createBlankDraft();
    return {
      drafts: [blank],
      selectedLocalId: blank.localId,
      savedSnapshots: { [blank.localId]: "" },
    };
  }

  const drafts = initialDrafts.map((draft) => toEditableDraft(draft));
  const savedSnapshots = Object.fromEntries(
    drafts.map((draft) => [draft.localId, serializeDraft(draft)])
  );

  return {
    drafts,
    selectedLocalId: drafts[0].localId,
    savedSnapshots,
  };
}

function swapProblems(
  problems: ManualPsetProblem[],
  fromIndex: number,
  toIndex: number
) {
  const next = [...problems];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export default function ManualPsetEditor({
  canEdit,
  initialDrafts,
}: {
  canEdit: boolean;
  initialDrafts: UserPsetDraft[];
}) {
  const [editorState, setEditorState] = useState<EditorState>(() =>
    createInitialState(initialDrafts)
  );
  const [activeProblemIndex, setActiveProblemIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const selectedDraft = useMemo(
    () =>
      editorState.drafts.find((draft) => draft.localId === editorState.selectedLocalId) ??
      editorState.drafts[0] ??
      null,
    [editorState]
  );

  const clampedProblemIndex =
    selectedDraft && selectedDraft.problems.length > 0
      ? Math.min(activeProblemIndex, selectedDraft.problems.length - 1)
      : 0;

  const activeProblem =
    selectedDraft?.problems.length ? selectedDraft.problems[clampedProblemIndex] : null;

  const isDirty = selectedDraft
    ? editorState.savedSnapshots[selectedDraft.localId] !== serializeDraft(selectedDraft)
    : false;

  function selectDraft(localId: string) {
    setEditorState((prev) => ({ ...prev, selectedLocalId: localId }));
    setActiveProblemIndex(0);
    setStatus(null);
  }

  function updateSelectedDraft(mutator: (draft: EditableDraft) => EditableDraft) {
    setEditorState((prev) => ({
      ...prev,
      drafts: prev.drafts.map((draft) =>
        draft.localId === prev.selectedLocalId
          ? { ...mutator(draft), updated_at: new Date().toISOString() }
          : draft
      ),
    }));
  }

  function createNewDraft() {
    const blank = createBlankDraft();
    setEditorState((prev) => ({
      drafts: [blank, ...prev.drafts],
      selectedLocalId: blank.localId,
      savedSnapshots: {
        ...prev.savedSnapshots,
        [blank.localId]: "",
      },
    }));
    setActiveProblemIndex(0);
    setStatus({
      tone: "muted",
      text: "New local draft created. Save it when you want it persisted.",
    });
  }

  function updateDraftField(
    field: "title" | "source_pdf_label" | "source_pdf_url" | "notes",
    value: string
  ) {
    updateSelectedDraft((draft) => {
      if (field === "title") {
        return {
          ...draft,
          title: value,
        };
      }

      return {
        ...draft,
        [field]: value || null,
      };
    });
  }

  function updateProblemField(
    field: "label" | "questionText" | "solutionText",
    value: string
  ) {
    if (!selectedDraft) return;

    updateSelectedDraft((draft) => ({
      ...draft,
      problems: draft.problems.map((problem, index) =>
        index === clampedProblemIndex ? { ...problem, [field]: value } : problem
      ),
    }));
  }

  function addProblem() {
    if (!selectedDraft) return;

    const nextIndex = selectedDraft.problems.length;
    updateSelectedDraft((draft) => ({
      ...draft,
      problems: [...draft.problems, createProblem(nextIndex)],
    }));
    setActiveProblemIndex(nextIndex);
  }

  function removeProblem() {
    if (!selectedDraft || !activeProblem) return;

    if (selectedDraft.problems.length === 1) {
      updateSelectedDraft((draft) => ({
        ...draft,
        problems: [
          {
            ...draft.problems[0],
            label: "Problem 1",
            questionText: "",
            solutionText: "",
          },
        ],
      }));
      return;
    }

    updateSelectedDraft((draft) => ({
      ...draft,
      problems: draft.problems.filter((problem) => problem.id !== activeProblem.id),
    }));
    setActiveProblemIndex((index) => Math.max(0, index - 1));
  }

  function moveProblem(direction: -1 | 1) {
    if (!selectedDraft || !activeProblem) return;

    const destination = clampedProblemIndex + direction;
    if (destination < 0 || destination >= selectedDraft.problems.length) return;

    updateSelectedDraft((draft) => ({
      ...draft,
      problems: swapProblems(draft.problems, clampedProblemIndex, destination),
    }));
    setActiveProblemIndex(destination);
  }

  async function saveDraft() {
    if (!selectedDraft || !canEdit) return;

    setIsSaving(true);
    setStatus({ tone: "muted", text: "Saving draft..." });

    const payload = toDraftInput(selectedDraft);
    const savedDraft = selectedDraft.isNew
      ? await createUserPsetDraft(payload)
      : await updateUserPsetDraft(selectedDraft.id, payload);

    if (!savedDraft) {
      setStatus({
        tone: "error",
        text: "Save failed. Check the dev account session and Supabase table setup.",
      });
      setIsSaving(false);
      return;
    }

    const nextDraft = toEditableDraft(savedDraft, selectedDraft.localId);

    setEditorState((prev) => ({
      selectedLocalId: prev.selectedLocalId,
      drafts: prev.drafts
        .map((draft) => (draft.localId === selectedDraft.localId ? nextDraft : draft))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
      savedSnapshots: {
        ...prev.savedSnapshots,
        [selectedDraft.localId]: serializeDraft(nextDraft),
      },
    }));
    setStatus({ tone: "success", text: "Draft saved." });
    setIsSaving(false);
  }

  async function removeDraft() {
    if (!selectedDraft) return;

    setIsDeleting(true);
    setStatus({ tone: "muted", text: "Removing draft..." });

    if (!selectedDraft.isNew) {
      const deleted = await deleteUserPsetDraft(selectedDraft.id);
      if (!deleted) {
        setStatus({
          tone: "error",
          text: "Delete failed. Check the dev account session and Supabase table setup.",
        });
        setIsDeleting(false);
        return;
      }
    }

    setEditorState((prev) => {
      const draftIndex = prev.drafts.findIndex((draft) => draft.localId === selectedDraft.localId);
      const nextDrafts = prev.drafts.filter((draft) => draft.localId !== selectedDraft.localId);
      const nextSnapshots = { ...prev.savedSnapshots };
      delete nextSnapshots[selectedDraft.localId];

      if (nextDrafts.length === 0) {
        const blank = createBlankDraft();
        return {
          drafts: [blank],
          selectedLocalId: blank.localId,
          savedSnapshots: { [blank.localId]: "" },
        };
      }

      const nextSelected =
        nextDrafts[Math.max(0, Math.min(draftIndex, nextDrafts.length - 1))].localId;

      return {
        drafts: nextDrafts,
        selectedLocalId: nextSelected,
        savedSnapshots: nextSnapshots,
      };
    });
    setActiveProblemIndex(0);
    setStatus({
      tone: "success",
      text: selectedDraft.isNew ? "Local draft discarded." : "Draft deleted.",
    });
    setIsDeleting(false);
  }

  if (!canEdit) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Editor unavailable</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This manual PDF-to-pset workspace is hard-coded to the dev account
          `ardatasci@nyu.edu`. Sign into that account to edit problem sets here.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Drafts
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Private working copies for manual transcription.
            </p>
          </div>
          <button
            onClick={createNewDraft}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            New draft
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {editorState.drafts.map((draft) => {
            const selected = draft.localId === selectedDraft?.localId;
            const dirty =
              editorState.savedSnapshots[draft.localId] !== serializeDraft(draft);

            return (
              <button
                key={draft.localId}
                onClick={() => selectDraft(draft.localId)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                  selected
                    ? "border-[#750014] bg-[#750014]/5"
                    : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="line-clamp-1 text-sm font-semibold text-zinc-900">
                    {draft.title}
                  </p>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                      draft.isNew
                        ? "bg-amber-100 text-amber-800"
                        : dirty
                          ? "bg-zinc-200 text-zinc-700"
                          : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {draft.isNew ? "Local" : dirty ? "Unsaved" : "Saved"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-1 text-xs text-zinc-500">
                  {draft.source_pdf_label || "No source PDF label yet"}
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  {draft.problems.length} problem{draft.problems.length === 1 ? "" : "s"}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {selectedDraft && activeProblem ? (
        <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-zinc-200 px-6 py-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#750014]">
                Manual editor
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                {selectedDraft.title}
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                {isDirty
                  ? "You have unsaved edits."
                  : `Last saved ${timestampFormatter.format(new Date(selectedDraft.updated_at))}.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {status && (
                <span
                  className={`text-sm ${
                    status.tone === "error"
                      ? "text-red-600"
                      : status.tone === "success"
                        ? "text-emerald-700"
                        : "text-zinc-500"
                  }`}
                >
                  {status.text}
                </span>
              )}
              <button
                onClick={removeDraft}
                disabled={isDeleting}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-60"
              >
                {isDeleting ? "Removing..." : "Delete draft"}
              </button>
              <button
                onClick={saveDraft}
                disabled={isSaving}
                className="rounded-xl bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save draft"}
              </button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-zinc-200 px-6 py-6 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-700">Problem set title</span>
              <input
                value={selectedDraft.title}
                onChange={(event) => updateDraftField("title", event.target.value)}
                placeholder="Problem Set 5"
                className={inputClassName}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-700">Source PDF label</span>
              <input
                value={selectedDraft.source_pdf_label ?? ""}
                onChange={(event) => updateDraftField("source_pdf_label", event.target.value)}
                placeholder="6.046J Problem Set 5"
                className={inputClassName}
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-zinc-700">Source PDF URL</span>
              <input
                value={selectedDraft.source_pdf_url ?? ""}
                onChange={(event) => updateDraftField("source_pdf_url", event.target.value)}
                placeholder="https://..."
                className={inputClassName}
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-zinc-700">Notes</span>
              <textarea
                value={selectedDraft.notes ?? ""}
                onChange={(event) => updateDraftField("notes", event.target.value)}
                placeholder="Transcription notes, page ranges, formatting reminders..."
                className={`${inputClassName} min-h-[100px] resize-y`}
              />
            </label>
          </div>

          <div className="grid gap-6 px-6 py-6 xl:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Problems
                </h3>
                <button
                  onClick={addProblem}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {selectedDraft.problems.map((problem, index) => (
                  <button
                    key={problem.id}
                    onClick={() => setActiveProblemIndex(index)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      index === clampedProblemIndex
                        ? "border-[#750014] bg-[#750014]/5"
                        : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    <p className="line-clamp-1 text-sm font-medium text-zinc-900">
                      {problem.label || `Problem ${index + 1}`}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {problem.questionText.trim()
                        ? problem.questionText.trim().slice(0, 80)
                        : "No prompt yet"}
                    </p>
                  </button>
                ))}
              </div>
            </aside>

            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    Editing {activeProblem.label || `Problem ${clampedProblemIndex + 1}`}
                  </p>
                  <p className="text-sm text-zinc-500">
                    Keep the prompt and worked solution together while you transcribe.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => moveProblem(-1)}
                    disabled={clampedProblemIndex === 0}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50"
                  >
                    Move up
                  </button>
                  <button
                    onClick={() => moveProblem(1)}
                    disabled={clampedProblemIndex === selectedDraft.problems.length - 1}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50"
                  >
                    Move down
                  </button>
                  <button
                    onClick={removeProblem}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                  >
                    Remove problem
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-zinc-700">Problem label</span>
                  <input
                    value={activeProblem.label}
                    onChange={(event) => updateProblemField("label", event.target.value)}
                    placeholder={`Problem ${clampedProblemIndex + 1}`}
                    className={inputClassName}
                  />
                </label>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Problem count
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-900">
                    {selectedDraft.problems.length}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-zinc-700">Problem prompt</span>
                  <textarea
                    value={activeProblem.questionText}
                    onChange={(event) =>
                      updateProblemField("questionText", event.target.value)
                    }
                    placeholder="Paste or type the problem statement here."
                    className={textAreaClassName}
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-zinc-700">Solution</span>
                  <textarea
                    value={activeProblem.solutionText}
                    onChange={(event) =>
                      updateProblemField("solutionText", event.target.value)
                    }
                    placeholder="Add the worked solution here."
                    className={textAreaClassName}
                  />
                </label>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Prompt preview
                  </p>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-800">
                    <MathText>
                      {activeProblem.questionText.trim()
                        ? activeProblem.questionText
                        : "The problem prompt preview will appear here."}
                    </MathText>
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-emerald-50/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    Solution preview
                  </p>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-800">
                    <MathText>
                      {activeProblem.solutionText.trim()
                        ? activeProblem.solutionText
                        : "The worked solution preview will appear here."}
                    </MathText>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
