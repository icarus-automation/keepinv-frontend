import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ScanReceipt } from './scan-receipt';

describe('ScanReceipt', () => {
  let component: ScanReceipt;
  let fixture: ComponentFixture<ScanReceipt>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScanReceipt],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanReceipt);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
