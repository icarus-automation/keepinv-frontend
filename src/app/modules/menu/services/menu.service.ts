import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ApiResponse } from '../../../../common/responses/api.response';
import {
  MenuFlavor,
  MenuFlavorRequest,
  MenuGroup,
  MenuGroupRequest,
} from '../types/menu.types';

/**
 * Talks to the menu API (owner/admin only). Thin by design: the Bearer token is attached by the
 * global auth interceptor and the response envelope is unwrapped here, so callers only ever see
 * domain types. The cashier reads the same menu through `PosService.getMenu()`.
 */
@Injectable({ providedIn: 'root' })
export class MenuService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/menu`;

  listGroups(): Observable<MenuGroup[]> {
    return this.http
      .get<ApiResponse<MenuGroup[]>>(`${this.baseUrl}/groups`)
      .pipe(map((response) => response.data));
  }

  createGroup(body: MenuGroupRequest): Observable<MenuGroup> {
    return this.http
      .post<ApiResponse<MenuGroup>>(`${this.baseUrl}/groups`, body)
      .pipe(map((response) => response.data));
  }

  updateGroup(id: string, body: MenuGroupRequest): Observable<MenuGroup> {
    return this.http
      .patch<ApiResponse<MenuGroup>>(`${this.baseUrl}/groups/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Soft delete. Refused by the API while sizes are still attached to the group. */
  archiveGroup(id: string): Observable<MenuGroup> {
    return this.http
      .delete<ApiResponse<MenuGroup>>(`${this.baseUrl}/groups/${id}`)
      .pipe(map((response) => response.data));
  }

  createFlavor(groupId: string, body: MenuFlavorRequest): Observable<MenuFlavor> {
    return this.http
      .post<ApiResponse<MenuFlavor>>(`${this.baseUrl}/groups/${groupId}/flavors`, body)
      .pipe(map((response) => response.data));
  }

  updateFlavor(id: string, body: MenuFlavorRequest): Observable<MenuFlavor> {
    return this.http
      .patch<ApiResponse<MenuFlavor>>(`${this.baseUrl}/flavors/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /** Soft delete. Refused by the API on a group's last flavor. */
  archiveFlavor(id: string): Observable<MenuFlavor> {
    return this.http
      .delete<ApiResponse<MenuFlavor>>(`${this.baseUrl}/flavors/${id}`)
      .pipe(map((response) => response.data));
  }
}
