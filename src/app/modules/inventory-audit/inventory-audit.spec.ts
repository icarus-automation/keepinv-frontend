import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { InventoryAudit } from './inventory-audit';

describe('InventoryAudit', () => {
  let component: InventoryAudit;
  let fixture: ComponentFixture<InventoryAudit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryAudit],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryAudit);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
