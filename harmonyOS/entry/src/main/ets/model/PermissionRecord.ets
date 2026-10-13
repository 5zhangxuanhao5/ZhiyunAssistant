export interface PermissionValue { live?: boolean | number | string; video?: boolean | number | string }
export interface PermissionRecord { courseId: string; subId: string; permission: PermissionValue; checkedAt: number }
export interface PermissionStorage {
  permissionRecord(courseId: string, subId: string): PermissionRecord | undefined;
  savePermissions(records: PermissionRecord[]): void;
}
