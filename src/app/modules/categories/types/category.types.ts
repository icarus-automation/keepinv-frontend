/** A user-defined asset grouping (e.g. "Engine", "Hand Tools", "Garage Equipment"). */
export interface Category {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating or updating a category. */
export interface CategoryRequest {
  name: string;
  description?: string;
}
