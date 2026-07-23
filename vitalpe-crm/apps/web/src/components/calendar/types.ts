/**
 * The shape a calendar event takes once it has left the database.
 *
 * Deliberately flat and fully serialisable: it crosses the server → client
 * boundary on every render, and everything the day view has to show — hour,
 * duration, company, action, commercial, location, product, importance, state
 * and synchronisation — is already here, so no cell ever needs a second query.
 */
export interface CalendarEvent {
  id: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  /** ISO-8601 instants. */
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  taskStatus: string | null;
  action: string;
  priority: string;
  objective: string | null;
  importantInfo: string | null;
  result: string | null;
  assigneeId: string | null;
  assignee: string | null;
  productName: string | null;
  locationLabel: string | null;
  mapsUrl: string | null;
  syncState: string | null;
  syncOrigin: string | null;
  syncError: string | null;
  lastSyncedAt: string | null;
  googleUrl: string | null;
  syncEnabled: boolean;
  cancellationReason: string | null;
  cancellationOrigin: string | null;
  editable: boolean;
}

export interface CommercialOption {
  id: string;
  name: string;
}

export interface CompanyLocation {
  id: string;
  label: string;
}
