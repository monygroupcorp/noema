import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// Prompt augmentation, offered everywhere. When the user focuses a text field in a
// form (not full chat), it publishes itself here; the Concierge bubble picks it up,
// slides open, and offers a tailored example + a "write it for me" draft.
export interface AssistTarget {
  flowId: string;
  flowName: string;
  fieldKey: string;
  fieldLabel: string;
  example: string;                 // beckoning fill-in-the-blank the user can copy/use
  hint?: string;                   // the field's own schema description, if any
  apply: (text: string) => void;   // write text back into the focused field
}

interface AssistCtx {
  target: AssistTarget | null;
  setTarget: (t: AssistTarget) => void;
  // Clear unconditionally, or only if the live target matches (so a stale field
  // unmounting doesn't wipe a newer field's target).
  clear: (flowId?: string, fieldKey?: string) => void;
}

const Ctx = createContext<AssistCtx | null>(null);

export function PromptAssistProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<AssistTarget | null>(null);
  const setTarget = useCallback((t: AssistTarget) => setTargetState(t), []);
  const clear = useCallback((flowId?: string, fieldKey?: string) => {
    setTargetState((cur) => {
      if (!cur) return null;
      if (flowId && (cur.flowId !== flowId || cur.fieldKey !== fieldKey)) return cur;
      return null;
    });
  }, []);
  return <Ctx.Provider value={{ target, setTarget, clear }}>{children}</Ctx.Provider>;
}

/** For the Concierge — read the live assist target. */
export function useAssistTarget(): AssistTarget | null {
  return useContext(Ctx)?.target ?? null;
}

/** For form fields — get the setter/clearer to wire focus + unmount. */
export function usePromptAssist(): Pick<AssistCtx, 'setTarget' | 'clear'> {
  const ctx = useContext(Ctx);
  return { setTarget: ctx?.setTarget ?? (() => {}), clear: ctx?.clear ?? (() => {}) };
}

/**
 * One-line field wiring. Spread the result onto any text input/textarea to make the
 * Concierge slide open with augmentation when it's focused:
 *   <input {...assist({ flowId, flowName, fieldKey, fieldLabel, example, apply })} />
 * Pair with a `useEffect(() => () => clear(), [clear])` so the target releases on unmount.
 */
export function useAssistField(): (spec: AssistTarget) => { onFocus: () => void } {
  const { setTarget } = usePromptAssist();
  return useCallback((spec: AssistTarget) => ({ onFocus: () => setTarget(spec) }), [setTarget]);
}
