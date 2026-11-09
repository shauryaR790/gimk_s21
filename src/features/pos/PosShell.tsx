import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { PosProvider } from './PosContext';
import { OdooBackendLayout } from './odoo/OdooBackendLayout';
import { OdooFoHLayout } from './odoo/OdooFoHLayout';
import { DashboardPage } from './odoo/DashboardPage';
import { RegisterPage } from './odoo/RegisterPage';
import { PaymentPage } from './odoo/PaymentPage';
import { ProductsKanbanPage } from './odoo/ProductsKanbanPage';
import { ProductFormPage } from './odoo/ProductFormPage';
import { ReportingPage } from './odoo/ReportingPage';
import { BackendInventoryPage } from './odoo/BackendInventoryPage';
import { ConfigPage } from './odoo/ConfigPage';
import { BackendPlaceholderPage } from './odoo/BackendPlaceholderPage';
import { CustomerDisplayPage } from './odoo/CustomerDisplayPage';
import {
  BookingsPage,
  CheckInPage,
  ClassesPage,
  EmployeesPage,
  FacilitiesPage,
  MaintenancePage,
  MembersPage,
  ShiftPage,
  NotificationsPage,
  SessionsPage,
  TrainerRequestsPage,
} from './gym/centre';
import { CommunicationsPage } from './gym/comms';
import {
  BookingRecordPage,
  FacilityRecordPage,
  InventoryRecordPage,
  JoinRequestRecordPage,
  MaintenanceRecordPage,
  ParticipantRecordPage,
  PlanRecordPage,
  ShiftRecordPage,
  TrainerRecordPage,
  VisitorRecordPage,
} from './gym/forms';
import { SettingsPage } from './SettingsPage';
import { MenuAdminPage } from './MenuAdminPage';

function RedirectRegister() {
  const { search } = useLocation();
  return <Navigate to={`/pos/app/register${search}`} replace />;
}

function VisitorToPeople() {
  const { id } = useParams();
  return <Navigate to={`/pos/backend/people/${id ?? ''}`} replace />;
}

export default function PosShell() {
  return (
    <PosProvider>
      <Routes>
        <Route element={<OdooBackendLayout />}>
          <Route index element={<ReportingPage />} />
          <Route path="backend/overview" element={<DashboardPage />} />
          <Route path="backend/orders" element={<Navigate to="/pos/backend/bookings" replace />} />
          <Route path="backend/sessions" element={<SessionsPage />} />
          <Route path="backend/payments" element={<BackendPlaceholderPage title="Payments" />} />
          <Route path="backend/preparation" element={<Navigate to="/pos/backend/classes" replace />} />
          <Route path="backend/customers" element={<Navigate to="/pos/backend/people" replace />} />
          <Route path="backend/members" element={<Navigate to="/pos/backend/people" replace />} />
          <Route path="backend/people/new" element={<VisitorRecordPage />} />
          <Route path="backend/people/:id" element={<VisitorRecordPage />} />
          <Route path="backend/people" element={<MembersPage />} />
          <Route path="backend/visitors/new" element={<Navigate to="/pos/backend/people/new" replace />} />
          <Route path="backend/visitors/:id" element={<VisitorToPeople />} />
          <Route path="backend/visitors" element={<Navigate to="/pos/backend/people" replace />} />
          <Route path="backend/shift/new" element={<ShiftRecordPage />} />
          <Route path="backend/shift/:id" element={<ShiftRecordPage />} />
          <Route path="backend/shift" element={<ShiftPage />} />
          <Route path="backend/memberships" element={<Navigate to="/pos/backend/people?tab=members" replace />} />
          <Route path="backend/plans/new" element={<PlanRecordPage />} />
          <Route path="backend/plans/:id" element={<PlanRecordPage />} />
          <Route path="backend/trainers/new" element={<TrainerRecordPage />} />
          <Route path="backend/trainers/:id" element={<TrainerRecordPage />} />
          <Route path="backend/trainers" element={<Navigate to="/pos/backend/classes" replace />} />
          <Route path="backend/trainer-requests" element={<TrainerRequestsPage />} />
          <Route path="backend/trainer-requests/:id" element={<JoinRequestRecordPage route="TRAINER" />} />
          <Route path="backend/membership-requests" element={<Navigate to="/pos/backend/people?tab=requests" replace />} />
          <Route path="backend/membership-requests/:id" element={<JoinRequestRecordPage route="STAFF" />} />
          <Route path="backend/facilities/new" element={<FacilityRecordPage />} />
          <Route path="backend/facilities/:id" element={<FacilityRecordPage />} />
          <Route path="backend/facilities" element={<FacilitiesPage />} />
          <Route path="backend/bookings/new" element={<BookingRecordPage />} />
          <Route path="backend/bookings/:id" element={<BookingRecordPage />} />
          <Route path="backend/bookings" element={<BookingsPage />} />
          <Route path="backend/check-in" element={<CheckInPage />} />
          <Route path="backend/classes" element={<ClassesPage />} />
          <Route path="backend/participants/new" element={<ParticipantRecordPage />} />
          <Route path="backend/rentals" element={<Navigate to="/pos/backend/inventory" replace />} />
          <Route path="backend/employees" element={<EmployeesPage />} />
          <Route path="backend/maintenance/new" element={<MaintenanceRecordPage />} />
          <Route path="backend/maintenance/:id" element={<MaintenanceRecordPage />} />
          <Route path="backend/maintenance" element={<MaintenancePage />} />
          <Route path="backend/notifications" element={<NotificationsPage />} />
          <Route path="backend/communications/reports/:id" element={<CommunicationsPage />} />
          <Route path="backend/communications/:tab" element={<CommunicationsPage />} />
          <Route path="backend/communications" element={<CommunicationsPage />} />
          <Route path="backend/products" element={<ProductsKanbanPage />} />
          <Route path="backend/inventory/new" element={<InventoryRecordPage />} />
          <Route path="backend/inventory/:id" element={<InventoryRecordPage />} />
          <Route path="backend/inventory" element={<BackendInventoryPage />} />
          <Route path="backend/products/:id" element={<ProductFormPage />} />
          <Route path="backend/reporting" element={<Navigate to="/pos" replace />} />
          <Route path="backend/config" element={<ConfigPage />} />
          <Route path="customers" element={<Navigate to="/pos/backend/members" replace />} />
          <Route path="inventory" element={<BackendInventoryPage />} />
          <Route path="menu" element={<MenuAdminPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="reports" element={<Navigate to="/pos" replace />} />
          <Route path="payments" element={<Navigate to="/pos/backend/payments" replace />} />
        </Route>

        <Route path="prep" element={<Navigate to="/pos/backend/classes" replace />} />
        <Route path="prep/status" element={<Navigate to="/pos/backend/classes" replace />} />

        <Route path="app" element={<OdooFoHLayout />}>
          <Route index element={<Navigate to="register" replace />} />
          <Route path="tables" element={<Navigate to="/pos/backend/facilities" replace />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="payment" element={<PaymentPage />} />
          <Route path="orders" element={<Navigate to="/pos/backend/bookings" replace />} />
          <Route path="customer-display" element={<CustomerDisplayPage />} />
        </Route>

        {/* Legacy paths → Odoo FoH */}
        <Route path="app/floors/edit" element={<Navigate to="/pos/backend/facilities" replace />} />

        <Route path="tables" element={<Navigate to="/pos/backend/facilities" replace />} />
        <Route path="orders/new" element={<RedirectRegister />} />
        <Route path="orders" element={<Navigate to="/pos/backend/bookings" replace />} />
        <Route path="orders/:id" element={<Navigate to="/pos/backend/bookings" replace />} />
      </Routes>
    </PosProvider>
  );
}
