/**
 * Types for review/edit UI
 */

import type { FinalSection } from "@/lib/segmenter/types";

export interface EditableSection extends FinalSection {
  /** Unique ID for React keys */
  id: string;
  /** Whether this section is being edited */
  isEditing?: boolean;
  /** Whether summary is being regenerated */
  isRegeneratingSummary?: boolean;
}

