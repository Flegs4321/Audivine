/**
 * JSON shape expected by bulletin-final/template/template.docx (see bulletin-final/generate.js).
 */
export type SonlightBulletinJson = {
  date: string;
  announcements: {
    this_evening: string;
    wednesday_eve: string;
    next_sunday_devotions: string;
    next_sunday_chair_set_up: string;
    next_sunday_host_hostess: string;
    additional: string[];
  };
  upcoming_events: string[];
  prayer_sharing: {
    in_service: string;
    items: string[];
  };
  message: {
    speaker: string;
    title: string;
    points: string[];
  };
};
