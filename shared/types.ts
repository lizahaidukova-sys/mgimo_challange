// Общие типы клиента и сервера. Единственный источник правды для статусов.

export type Role = 'student' | 'staff';

export type RequestStatus = 'submitted' | 'in_progress' | 'ready' | 'rejected';
export type RequestType =
  | 'certificate_study'
  | 'certificate_scholarship'
  | 'retake_application';

export type LessonStatus = 'normal' | 'moved' | 'cancelled';
export type EnrollmentStatus = 'passed' | 'pending' | 'debt' | 'failed';

export type Severity = 'green' | 'yellow' | 'red';

export interface SessionUser {
  id: number;
  role: Role;
  email: string;
  fullName: string;
  faculty: string;
  program: string;
  course: number;
  groupName: string;
}

export interface Teacher {
  id: number;
  fullName: string;
  title: string;
}

export interface Room {
  id: number;
  name: string;
  building: string;
}

export interface Lesson {
  id: number;
  courseId: number;
  courseTitle: string;
  teacherName: string;
  roomName: string;
  building: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  status: LessonStatus;
  note: string | null;
  previousStartsAt: string | null;
}

export interface GradeRow {
  enrollmentId: number;
  courseId: number;
  title: string;
  teacherName: string;
  credits: number;
  controlForm: 'exam' | 'pass';
  grade: number | null;
  gradeLabel: string;
  status: EnrollmentStatus;
  retakeCount: number;
  debtSince: string | null;
  debtDeadline: string | null;
  updatedAt: string;
}

export interface SessionState {
  severity: Severity;
  debts: number;
  overdue: number;
  gpa: number | null;
  headline: string;
  explanation: string;
  actions: { courseId: number; title: string; deadline: string | null; why: string }[];
  generatedBy: 'rules' | 'llm';
}

export interface RequestEvent {
  id: number;
  status: RequestStatus;
  comment: string | null;
  actorName: string;
  createdAt: string;
}

export interface RequestRow {
  id: number;
  type: RequestType;
  typeLabel: string;
  status: RequestStatus;
  statusLabel: string;
  dueAt: string;
  staffComment: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  payload: Record<string, string>;
}

export interface RequestDetail extends RequestRow {
  events: RequestEvent[];
}

export interface NotificationRow {
  id: number;
  kind: 'announcement' | 'request_status' | 'schedule_change';
  title: string;
  body: string;
  refId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardData {
  user: SessionUser;
  todayLessons: Lesson[];
  changes: { id: string; kind: string; title: string; body: string; at: string }[];
  sessionState: SessionState;
  activeRequests: RequestRow[];
  unreadNotifications: number;
  nextDeadline: { title: string; at: string } | null;
}

export interface StaffRequestRow extends RequestRow {
  studentName: string;
  studentGroup: string;
}

export interface StaffOverview {
  total: number;
  byStatus: Record<RequestStatus, number>;
  overdue: number;
  oldestSubmittedAt: string | null;
  todayRequests: number;
}

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  certificate_study: 'Справка об обучении',
  certificate_scholarship: 'Справка для стипендии',
  retake_application: 'Заявление на пересдачу',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: 'Подана',
  in_progress: 'В работе',
  ready: 'Готова',
  rejected: 'Отклонена',
};

// Нормативные сроки в рабочих днях для каждого типа заявки.
export const REQUEST_DUE_DAYS: Record<RequestType, number> = {
  certificate_study: 3,
  certificate_scholarship: 5,
  retake_application: 2,
};

export const GRADE_LABEL: Record<number, string> = {
  5: 'отлично',
  4: 'хорошо',
  3: 'удовлетворительно',
  2: 'неудовлетворительно',
};

export const API_ERRORS = {
  unauthorized: 'Требуется вход',
  forbidden: 'Недостаточно прав',
  notFound: 'Не найдено',
  invalid: 'Проверьте поля формы',
} as const;
