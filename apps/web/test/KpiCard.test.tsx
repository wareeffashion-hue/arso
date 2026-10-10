import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from '../components/KpiCard';

describe('KpiCard', () => {
  it('AC01/AC10: القيمة المفقودة تظهر «غير متوفر» ولا تظهر صفرًا', () => {
    render(<KpiCard label="المساهمة بعد التسويق" value={null} quality="incomplete" money />);
    expect(screen.getByText('غير متوفر')).toBeTruthy();
    expect(screen.queryByText(/0\.00/)).toBeNull();
    expect(screen.getByText('جزئي')).toBeTruthy();
  });

  it('يعرض المبلغ مع رمز الريال', () => {
    render(<KpiCard label="صافي المبيعات" value="84320.5" quality="complete" money />);
    expect(screen.getByText('84,320.50')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'ريال سعودي' })).toBeTruthy();
  });
});
