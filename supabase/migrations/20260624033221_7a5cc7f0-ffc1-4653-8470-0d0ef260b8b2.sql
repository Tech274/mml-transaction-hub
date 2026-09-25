
-- =========================================================================
-- ROLES
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('admin','leadership','finance','ops_lead','ops_user','viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- =========================================================================
-- PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auto-create profile + bootstrap first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first;
  IF is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- CUSTOMERS
-- =========================================================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Ops can create customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::public.app_role[]));
CREATE POLICY "Ops lead/admin can update customers" ON public.customers FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.set_normalized_customer()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_name := lower(regexp_replace(trim(NEW.customer_name), '\s+', ' ', 'g'));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER customers_normalize BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_normalized_customer();

-- =========================================================================
-- CONFIG MASTER
-- =========================================================================
CREATE TABLE public.config_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config_master TO authenticated;
GRANT ALL ON public.config_master TO service_role;
ALTER TABLE public.config_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read config" ON public.config_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage config" ON public.config_master FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.config_master (category, key, label, sort_order) VALUES
  ('lab_type','public_cloud','Public Cloud',1),
  ('lab_type','private_cloud','Private Cloud',2),
  ('cloud_provider','AWS','AWS',1),
  ('cloud_provider','Azure','Azure',2),
  ('cloud_provider','GCP','GCP',3),
  ('cloud_provider','MakeMyLabs Private Cloud','MakeMyLabs Private Cloud',4),
  ('line_of_business','Training','Training',1),
  ('line_of_business','Certification','Certification',2),
  ('line_of_business','POC','Proof of Concept',3),
  ('line_of_business','Hackathon','Hackathon',4),
  ('line_of_business','Workshop','Workshop',5),
  ('line_of_business','Enterprise Lab','Enterprise Lab',6);

-- =========================================================================
-- TRANSACTIONS
-- =========================================================================
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  potential_id TEXT NOT NULL UNIQUE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  customer_name TEXT NOT NULL,
  lab_name TEXT NOT NULL,
  lab_type TEXT NOT NULL CHECK (lab_type IN ('public_cloud','private_cloud')),
  repository_type TEXT NOT NULL CHECK (repository_type IN ('public_cloud','private_cloud')),
  cloud_provider TEXT NOT NULL,
  line_of_business TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_users INT NOT NULL CHECK (total_users > 0),
  selling_cost NUMERIC(14,2) NOT NULL CHECK (selling_cost >= 0),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_tx_repo ON public.transactions(repository_type) WHERE NOT is_deleted;
CREATE INDEX idx_tx_customer ON public.transactions(customer_id) WHERE NOT is_deleted;
CREATE INDEX idx_tx_year_month ON public.transactions(year, month) WHERE NOT is_deleted;
CREATE INDEX idx_tx_provider ON public.transactions(cloud_provider) WHERE NOT is_deleted;

GRANT SELECT, INSERT, UPDATE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read transactions" ON public.transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Ops create transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::public.app_role[])
              AND created_by = auth.uid());
CREATE POLICY "Ops update transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::public.app_role[])
    OR (public.has_role(auth.uid(),'ops_user') AND created_by = auth.uid())
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::public.app_role[])
    OR (public.has_role(auth.uid(),'ops_user') AND created_by = auth.uid())
  );

-- Classification + audit trigger
CREATE OR REPLACE FUNCTION public.classify_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lab_type = 'private_cloud' THEN
    NEW.repository_type := 'private_cloud';
    NEW.cloud_provider := 'MakeMyLabs Private Cloud';
  ELSIF NEW.lab_type = 'public_cloud' THEN
    NEW.repository_type := 'public_cloud';
    IF NEW.cloud_provider NOT IN ('AWS','Azure','GCP') THEN
      RAISE EXCEPTION 'Public Cloud transactions require cloud_provider in (AWS, Azure, GCP)';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid lab_type: %', NEW.lab_type;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER transactions_classify BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.classify_transaction();

-- =========================================================================
-- ACTIVITY LOG
-- =========================================================================
CREATE TABLE public.transaction_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_tx ON public.transaction_activity_log(transaction_id);
GRANT SELECT, INSERT ON public.transaction_activity_log TO authenticated;
GRANT ALL ON public.transaction_activity_log TO service_role;
ALTER TABLE public.transaction_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read activity" ON public.transaction_activity_log FOR SELECT TO authenticated USING (true);
-- Writes done by trigger (definer); no INSERT policy needed for users.

CREATE OR REPLACE FUNCTION public.log_transaction_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.transaction_activity_log (transaction_id, action, changed_by)
    VALUES (NEW.id, 'create', uid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
      INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
      VALUES (NEW.id, CASE WHEN NEW.is_deleted THEN 'soft_delete' ELSE 'restore' END,
              'is_deleted', OLD.is_deleted::text, NEW.is_deleted::text, uid);
    END IF;
    IF OLD.potential_id IS DISTINCT FROM NEW.potential_id THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'potential_id', OLD.potential_id, NEW.potential_id, uid, now()); END IF;
    IF OLD.customer_name IS DISTINCT FROM NEW.customer_name THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'customer_name', OLD.customer_name, NEW.customer_name, uid, now()); END IF;
    IF OLD.lab_name IS DISTINCT FROM NEW.lab_name THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'lab_name', OLD.lab_name, NEW.lab_name, uid, now()); END IF;
    IF OLD.lab_type IS DISTINCT FROM NEW.lab_type THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'lab_type', OLD.lab_type, NEW.lab_type, uid, now()); END IF;
    IF OLD.cloud_provider IS DISTINCT FROM NEW.cloud_provider THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'cloud_provider', OLD.cloud_provider, NEW.cloud_provider, uid, now()); END IF;
    IF OLD.line_of_business IS DISTINCT FROM NEW.line_of_business THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'line_of_business', OLD.line_of_business, NEW.line_of_business, uid, now()); END IF;
    IF OLD.start_date IS DISTINCT FROM NEW.start_date THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'start_date', OLD.start_date::text, NEW.start_date::text, uid, now()); END IF;
    IF OLD.end_date IS DISTINCT FROM NEW.end_date THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'end_date', OLD.end_date::text, NEW.end_date::text, uid, now()); END IF;
    IF OLD.total_users IS DISTINCT FROM NEW.total_users THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'total_users', OLD.total_users::text, NEW.total_users::text, uid, now()); END IF;
    IF OLD.selling_cost IS DISTINCT FROM NEW.selling_cost THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'selling_cost', OLD.selling_cost::text, NEW.selling_cost::text, uid, now()); END IF;
    IF OLD.month IS DISTINCT FROM NEW.month THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'month', OLD.month::text, NEW.month::text, uid, now()); END IF;
    IF OLD.year IS DISTINCT FROM NEW.year THEN
      INSERT INTO public.transaction_activity_log VALUES (gen_random_uuid(), NEW.id, 'update', 'year', OLD.year::text, NEW.year::text, uid, now()); END IF;
    NEW.updated_by := uid;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transactions_audit AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_transaction_activity();

-- Set created_by/updated_by automatically
CREATE OR REPLACE FUNCTION public.set_tx_actor()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    NEW.updated_by := COALESCE(NEW.updated_by, auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transactions_set_actor BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_tx_actor();
