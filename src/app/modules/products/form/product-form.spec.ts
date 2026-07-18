import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '../../../../environments/environment';
import { ProductForm } from './product-form';

describe('ProductForm', () => {
  let fixture: ComponentFixture<ProductForm>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductForm);
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/categories`).flush({
      statusCode: 200,
      message: 'ok',
      data: [],
    });
    httpMock.expectOne(`${environment.apiBaseUrl}/suppliers`).flush({
      statusCode: 200,
      message: 'ok',
      data: [],
    });
    httpMock.expectOne(`${environment.apiBaseUrl}/locations`).flush({
      statusCode: 200,
      message: 'ok',
      data: [],
    });
    // The ingredient picker pulls the whole catalog (paged); one empty page satisfies it.
    httpMock
      .expectOne((request) => request.url === `${environment.apiBaseUrl}/products`)
      .flush({
        statusCode: 200,
        message: 'ok',
        data: [],
        meta: { total: 0, page: 1, limit: 50, lastPage: 1 },
      });
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('emits cancelled when Escape is pressed', () => {
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
