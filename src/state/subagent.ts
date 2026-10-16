import { create } from "zustand";

/** The subagent session open in the viewer sheet, if any. */
export const useSubagentView = create<{ open: { sessionID: string; agent?: string; title?: string } | null }>(() => ({ open: null }));

export const openSubagent = (sessionID: string, agent?: string, title?: string) => useSubagentView.setState({ open: { sessionID, agent, title } });
export const closeSubagent = () => useSubagentView.setState({ open: null });
