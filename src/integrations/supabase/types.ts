export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_managers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          normalized_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          normalized_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          normalized_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_identities: {
        Row: {
          agent_id: number | null
          agent_name: string
          auto_matched: boolean
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: number | null
          agent_name: string
          auto_matched?: boolean
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: number | null
          agent_name?: string
          auto_matched?: boolean
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_cc_agent_workers: {
        Row: {
          agent_key: string
          created_at: string
          current_load: number
          id: string
          is_active: boolean
          last_assigned_at: string | null
          worker_name: string
        }
        Insert: {
          agent_key: string
          created_at?: string
          current_load?: number
          id?: string
          is_active?: boolean
          last_assigned_at?: string | null
          worker_name: string
        }
        Update: {
          agent_key?: string
          created_at?: string
          current_load?: number
          id?: string
          is_active?: boolean
          last_assigned_at?: string | null
          worker_name?: string
        }
        Relationships: []
      }
      ai_cc_audit: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          agent_key: string | null
          created_at: string
          detail: Json
          id: string
          inbox_id: string | null
          run_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          agent_key?: string | null
          created_at?: string
          detail?: Json
          id?: string
          inbox_id?: string | null
          run_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          agent_key?: string | null
          created_at?: string
          detail?: Json
          id?: string
          inbox_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_cc_audit_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "ai_cc_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_cc_audit_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_cc_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_cc_inbox: {
        Row: {
          agent_key: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_email: string | null
          decision_note: string | null
          id: string
          item_type: string
          payload: Json
          run_id: string | null
          status: string
          summary: string | null
          title: string
        }
        Insert: {
          agent_key: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_email?: string | null
          decision_note?: string | null
          id?: string
          item_type: string
          payload?: Json
          run_id?: string | null
          status?: string
          summary?: string | null
          title: string
        }
        Update: {
          agent_key?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_email?: string | null
          decision_note?: string | null
          id?: string
          item_type?: string
          payload?: Json
          run_id?: string | null
          status?: string
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_cc_inbox_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_cc_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_cc_lab_requests: {
        Row: {
          confirmed_at: string | null
          created_at: string
          customer_name: string
          id: string
          lab_name: string
          request_code: string
          requisition: Json
          status: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          customer_name: string
          id?: string
          lab_name: string
          request_code: string
          requisition?: Json
          status?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          customer_name?: string
          id?: string
          lab_name?: string
          request_code?: string
          requisition?: Json
          status?: string
        }
        Relationships: []
      }
      ai_cc_runs: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          agent_key: string
          created_at: string
          finished_at: string | null
          id: string
          input_json: Json
          job_hint: string | null
          output_json: Json
          status: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          agent_key: string
          created_at?: string
          finished_at?: string | null
          id?: string
          input_json?: Json
          job_hint?: string | null
          output_json?: Json
          status?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          agent_key?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          input_json?: Json
          job_hint?: string | null
          output_json?: Json
          status?: string
        }
        Relationships: []
      }
      ai_cc_work_items: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_agent_key: string | null
          assigned_worker_id: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          payload: Json
          requested_agent_key: string | null
          requires_approval: boolean
          status: string
          title: string
          updated_at: string
          work_type: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_agent_key?: string | null
          assigned_worker_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          payload?: Json
          requested_agent_key?: string | null
          requires_approval?: boolean
          status?: string
          title: string
          updated_at?: string
          work_type: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_agent_key?: string | null
          assigned_worker_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          payload?: Json
          requested_agent_key?: string | null
          requires_approval?: boolean
          status?: string
          title?: string
          updated_at?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_cc_work_items_assigned_worker_id_fkey"
            columns: ["assigned_worker_id"]
            isOneToOne: false
            referencedRelation: "ai_cc_agent_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_20261006_cloudtype: {
        Row: {
          backed_up_at: string | null
          cloud_provider: string | null
          id: string | null
          import_batch_id: string | null
          lab_type: string | null
          repository_type: string | null
          source_line: number | null
          system_config: string | null
        }
        Insert: {
          backed_up_at?: string | null
          cloud_provider?: string | null
          id?: string | null
          import_batch_id?: string | null
          lab_type?: string | null
          repository_type?: string | null
          source_line?: number | null
          system_config?: string | null
        }
        Update: {
          backed_up_at?: string | null
          cloud_provider?: string | null
          id?: string | null
          import_batch_id?: string | null
          lab_type?: string | null
          repository_type?: string | null
          source_line?: number | null
          system_config?: string | null
        }
        Relationships: []
      }
      backup_20261006_import_batches: {
        Row: {
          created_at: string | null
          created_by: string | null
          file_sha256: string | null
          filename: string | null
          id: string | null
          kind: string | null
          row_count: number | null
          status: string | null
          template_version: string | null
          total_input: number | null
          total_selling: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          file_sha256?: string | null
          filename?: string | null
          id?: string | null
          kind?: string | null
          row_count?: number | null
          status?: string | null
          template_version?: string | null
          total_input?: number | null
          total_selling?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          file_sha256?: string | null
          filename?: string | null
          id?: string | null
          kind?: string | null
          row_count?: number | null
          status?: string | null
          template_version?: string | null
          total_input?: number | null
          total_selling?: number | null
        }
        Relationships: []
      }
      backup_20261006_tx_activity_log: {
        Row: {
          action: string | null
          changed_at: string | null
          changed_by: string | null
          field_name: string | null
          id: string | null
          new_value: string | null
          old_value: string | null
          transaction_id: string | null
        }
        Insert: {
          action?: string | null
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string | null
          id?: string | null
          new_value?: string | null
          old_value?: string | null
          transaction_id?: string | null
        }
        Update: {
          action?: string | null
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string | null
          id?: string | null
          new_value?: string | null
          old_value?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      backup_20261006_tx_cost_corrections: {
        Row: {
          corrected_at: string | null
          corrected_by: string | null
          id: string | null
          new_actual_consumption: number | null
          new_credit_allocated: number | null
          new_input_cost: number | null
          new_selling_cost: number | null
          old_actual_consumption: number | null
          old_credit_allocated: number | null
          old_input_cost: number | null
          old_selling_cost: number | null
          reason: string | null
          transaction_id: string | null
        }
        Insert: {
          corrected_at?: string | null
          corrected_by?: string | null
          id?: string | null
          new_actual_consumption?: number | null
          new_credit_allocated?: number | null
          new_input_cost?: number | null
          new_selling_cost?: number | null
          old_actual_consumption?: number | null
          old_credit_allocated?: number | null
          old_input_cost?: number | null
          old_selling_cost?: number | null
          reason?: string | null
          transaction_id?: string | null
        }
        Update: {
          corrected_at?: string | null
          corrected_by?: string | null
          id?: string | null
          new_actual_consumption?: number | null
          new_credit_allocated?: number | null
          new_input_cost?: number | null
          new_selling_cost?: number | null
          old_actual_consumption?: number | null
          old_credit_allocated?: number | null
          old_input_cost?: number | null
          old_selling_cost?: number | null
          reason?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      backup_20261006_tx_import: {
        Row: {
          addon_revenue_total: number | null
          api_key_price_per_user: number | null
          api_key_service: string | null
          api_unit_label: string | null
          api_units_consumed: number | null
          cloud_provider: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          end_date: string | null
          id: string | null
          import_batch_id: string | null
          input_cost: number | null
          input_cost_actual_alloc: number | null
          input_cost_auto: number | null
          input_cost_auto_run_id: string | null
          input_cost_pct: number | null
          input_cost_per_user: number | null
          is_complete: boolean | null
          is_deleted: boolean | null
          lab_batch_id: string | null
          lab_name: string | null
          lab_type: string | null
          license_name: string | null
          license_price_per_user: number | null
          license_seats_used: number | null
          line_of_business: string | null
          month: number | null
          potential_id: string | null
          public_actual_consumption: number | null
          public_credit_allocated: number | null
          public_service_margin: number | null
          public_total_margin_actual: number | null
          public_unused_credit: number | null
          repository_type: string | null
          selling_cost: number | null
          selling_price_per_user: number | null
          source_line: number | null
          start_date: string | null
          system_config: string | null
          total_users: number | null
          updated_at: string | null
          updated_by: string | null
          vm_hours_consumed: number | null
          vm_price_per_user: number | null
          year: number | null
        }
        Insert: {
          addon_revenue_total?: number | null
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          cloud_provider?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          end_date?: string | null
          id?: string | null
          import_batch_id?: string | null
          input_cost?: number | null
          input_cost_actual_alloc?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean | null
          lab_batch_id?: string | null
          lab_name?: string | null
          lab_type?: string | null
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          public_service_margin?: number | null
          public_total_margin_actual?: number | null
          public_unused_credit?: number | null
          repository_type?: string | null
          selling_cost?: number | null
          selling_price_per_user?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string | null
          updated_by?: string | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          year?: number | null
        }
        Update: {
          addon_revenue_total?: number | null
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          cloud_provider?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          end_date?: string | null
          id?: string | null
          import_batch_id?: string | null
          input_cost?: number | null
          input_cost_actual_alloc?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean | null
          lab_batch_id?: string | null
          lab_name?: string | null
          lab_type?: string | null
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          public_service_margin?: number | null
          public_total_margin_actual?: number | null
          public_unused_credit?: number | null
          repository_type?: string | null
          selling_cost?: number | null
          selling_price_per_user?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string | null
          updated_by?: string | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          year?: number | null
        }
        Relationships: []
      }
      backup_20261006_tx_tags: {
        Row: {
          created_at: string | null
          created_by: string | null
          tag: string | null
          transaction_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          tag?: string | null
          transaction_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          tag?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      backup_txn_dates_20261006_97fa9e1c: {
        Row: {
          backed_up_at: string | null
          end_date: string | null
          id: string | null
          import_batch_id: string | null
          potential_id: string | null
          source_line: number | null
          start_date: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          backed_up_at?: string | null
          end_date?: string | null
          id?: string | null
          import_batch_id?: string | null
          potential_id?: string | null
          source_line?: number | null
          start_date?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          backed_up_at?: string | null
          end_date?: string | null
          id?: string | null
          import_batch_id?: string | null
          potential_id?: string | null
          source_line?: number | null
          start_date?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      bulk_import_audit_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          parent_run_id: string | null
          run_id: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          parent_run_id?: string | null
          run_id?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          parent_run_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_audit_events_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_audit_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_jobs: {
        Row: {
          cancel_requested: boolean
          created_at: string
          created_by: string
          error_message: string | null
          failed: number
          finished_at: string | null
          id: string
          imported: number
          linked: number
          processed: number
          run_id: string
          skipped: number
          started_at: string | null
          status: string
          succeeded: number
          total: number
          updated_at: string
          updated_rows: number
        }
        Insert: {
          cancel_requested?: boolean
          created_at?: string
          created_by?: string
          error_message?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          imported?: number
          linked?: number
          processed?: number
          run_id: string
          skipped?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total?: number
          updated_at?: string
          updated_rows?: number
        }
        Update: {
          cancel_requested?: boolean
          created_at?: string
          created_by?: string
          error_message?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          imported?: number
          linked?: number
          processed?: number
          run_id?: string
          skipped?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total?: number
          updated_at?: string
          updated_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_presets: {
        Row: {
          column_mapping: Json
          created_at: string
          created_by: string | null
          created_by_email: string | null
          duplicate_strategy: string
          id: string
          is_shared: boolean
          kind: string
          name: string
          update_fields: Json | null
          updated_at: string
        }
        Insert: {
          column_mapping: Json
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          duplicate_strategy: string
          id?: string
          is_shared?: boolean
          kind: string
          name: string
          update_fields?: Json | null
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          duplicate_strategy?: string
          id?: string
          is_shared?: boolean
          kind?: string
          name?: string
          update_fields?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      bulk_import_row_audit: {
        Row: {
          created_at: string
          error_message: string | null
          filename: string
          id: string
          line_number: number
          potential_id: string | null
          row_data: Json | null
          run_id: string
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          filename: string
          id?: string
          line_number: number
          potential_id?: string | null
          row_data?: Json | null
          run_id: string
          status: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          filename?: string
          id?: string
          line_number?: number
          potential_id?: string | null
          row_data?: Json | null
          run_id?: string
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_row_audit_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_runs: {
        Row: {
          column_mapping: Json | null
          completed_at: string | null
          created_at: string
          duplicate_strategy: string
          error_artifact_path: string | null
          filename: string
          id: string
          imported_rows: number
          invalid_rows: number
          kind: string
          linked_rows: number
          max_retries: number
          original_csv_path: string | null
          parent_run_id: string | null
          retry_count: number
          skipped_rows: number
          status: string
          total_rows: number
          update_fields: Json | null
          updated_rows: number
          user_email: string | null
          user_id: string
          valid_rows: number
        }
        Insert: {
          column_mapping?: Json | null
          completed_at?: string | null
          created_at?: string
          duplicate_strategy?: string
          error_artifact_path?: string | null
          filename: string
          id?: string
          imported_rows?: number
          invalid_rows?: number
          kind: string
          linked_rows?: number
          max_retries?: number
          original_csv_path?: string | null
          parent_run_id?: string | null
          retry_count?: number
          skipped_rows?: number
          status?: string
          total_rows?: number
          update_fields?: Json | null
          updated_rows?: number
          user_email?: string | null
          user_id: string
          valid_rows?: number
        }
        Update: {
          column_mapping?: Json | null
          completed_at?: string | null
          created_at?: string
          duplicate_strategy?: string
          error_artifact_path?: string | null
          filename?: string
          id?: string
          imported_rows?: number
          invalid_rows?: number
          kind?: string
          linked_rows?: number
          max_retries?: number
          original_csv_path?: string | null
          parent_run_id?: string | null
          retry_count?: number
          skipped_rows?: number
          status?: string
          total_rows?: number
          update_fields?: Json | null
          updated_rows?: number
          user_email?: string | null
          user_id?: string
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          reason: string | null
          row_key: string
          table_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          row_key: string
          table_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          row_key?: string
          table_name?: string
        }
        Relationships: []
      }
      cloud_provider_aliases: {
        Row: {
          alias_key: string
          approved_note: string
          code: string
          created_at: string
        }
        Insert: {
          alias_key: string
          approved_note: string
          code: string
          created_at?: string
        }
        Update: {
          alias_key?: string
          approved_note?: string
          code?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_provider_aliases_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "cloud_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      cloud_providers: {
        Row: {
          cloud_type: string
          code: string
          created_at: string
          provider: string
          sort_order: number
        }
        Insert: {
          cloud_type: string
          code: string
          created_at?: string
          provider: string
          sort_order: number
        }
        Update: {
          cloud_type?: string
          code?: string
          created_at?: string
          provider?: string
          sort_order?: number
        }
        Relationships: []
      }
      config_master: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      cost_rates: {
        Row: {
          currency: string
          key: string
          unit: string
          updated_at: string
          updated_by: string | null
          value: number | null
        }
        Insert: {
          currency?: string
          key: string
          unit: string
          updated_at?: string
          updated_by?: string | null
          value?: number | null
        }
        Update: {
          currency?: string
          key?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
          value?: number | null
        }
        Relationships: []
      }
      customer_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          changes: Json | null
          customer_id: string
          customer_name: string | null
          id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changes?: Json | null
          customer_id: string
          customer_name?: string | null
          id?: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changes?: Json | null
          customer_id?: string
          customer_name?: string | null
          id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          account_manager_name: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          customer_name: string
          deactivation_reason: string | null
          id: string
          industry: string | null
          is_active: boolean
          normalized_email: string | null
          normalized_name: string
          normalized_phone: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_manager_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_name: string
          deactivation_reason?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          normalized_email?: string | null
          normalized_name: string
          normalized_phone?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_manager_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string
          deactivation_reason?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          normalized_email?: string | null
          normalized_name?: string
          normalized_phone?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      freshdesk_tickets: {
        Row: {
          agent_name: string | null
          company_name: string | null
          description_text: string | null
          due_by: string | null
          fr_due_by: string | null
          group_name: string | null
          id: number
          is_escalated: boolean
          priority: string | null
          priority_id: number | null
          requester_email: string | null
          requester_name: string | null
          satisfaction_rating: string | null
          source: string | null
          stale_since: string | null
          status: string | null
          status_id: number | null
          subject: string | null
          synced_at: string
          tags: string[]
          ticket_created_at: string | null
          ticket_updated_at: string | null
          type: string | null
        }
        Insert: {
          agent_name?: string | null
          company_name?: string | null
          description_text?: string | null
          due_by?: string | null
          fr_due_by?: string | null
          group_name?: string | null
          id: number
          is_escalated?: boolean
          priority?: string | null
          priority_id?: number | null
          requester_email?: string | null
          requester_name?: string | null
          satisfaction_rating?: string | null
          source?: string | null
          stale_since?: string | null
          status?: string | null
          status_id?: number | null
          subject?: string | null
          synced_at?: string
          tags?: string[]
          ticket_created_at?: string | null
          ticket_updated_at?: string | null
          type?: string | null
        }
        Update: {
          agent_name?: string | null
          company_name?: string | null
          description_text?: string | null
          due_by?: string | null
          fr_due_by?: string | null
          group_name?: string | null
          id?: number
          is_escalated?: boolean
          priority?: string | null
          priority_id?: number | null
          requester_email?: string | null
          requester_name?: string | null
          satisfaction_rating?: string | null
          source?: string | null
          stale_since?: string | null
          status?: string | null
          status_id?: number | null
          subject?: string | null
          synced_at?: string
          tags?: string[]
          ticket_created_at?: string | null
          ticket_updated_at?: string | null
          type?: string | null
        }
        Relationships: []
      }
      import_approval_settings: {
        Row: {
          allow_self_approval: boolean
          approver_roles: Database["public"]["Enums"]["app_role"][]
          approver_user_ids: string[]
          id: number
          mode: string
          notify_in_app: boolean
          repeat_file_check: string
          stage_ttl: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_self_approval?: boolean
          approver_roles?: Database["public"]["Enums"]["app_role"][]
          approver_user_ids?: string[]
          id: number
          mode?: string
          notify_in_app?: boolean
          repeat_file_check?: string
          stage_ttl?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_self_approval?: boolean
          approver_roles?: Database["public"]["Enums"]["app_role"][]
          approver_user_ids?: string[]
          id?: number
          mode?: string
          notify_in_app?: boolean
          repeat_file_check?: string
          stage_ttl?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          file_sha256: string
          filename: string
          id: string
          kind: string
          row_count: number
          stage_id: string | null
          status: string
          template_version: string
          total_input: number
          total_selling: number
          uploaded_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          file_sha256: string
          filename: string
          id?: string
          kind: string
          row_count: number
          stage_id?: string | null
          status?: string
          template_version: string
          total_input: number
          total_selling: number
          uploaded_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          file_sha256?: string
          filename?: string
          id?: string
          kind?: string
          row_count?: number
          stage_id?: string | null
          status?: string
          template_version?: string
          total_input?: number
          total_selling?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "import_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      import_corrections: {
        Row: {
          created_at: string
          field: string
          healed_value: string
          healer_version: string
          id: number
          import_batch_id: string | null
          original_value: string | null
          rule: string
          source_line: number
          stage_id: string
          transaction_id: string | null
        }
        Insert: {
          created_at?: string
          field: string
          healed_value: string
          healer_version: string
          id?: never
          import_batch_id?: string | null
          original_value?: string | null
          rule: string
          source_line: number
          stage_id: string
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          field?: string
          healed_value?: string
          healer_version?: string
          id?: never
          import_batch_id?: string | null
          original_value?: string | null
          rule?: string
          source_line?: number
          stage_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_corrections_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_corrections_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "import_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_lab_transaction_profit_breakdown"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "import_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      import_stage_rows: {
        Row: {
          healed: Json
          is_incomplete: boolean
          original: Json
          source_line: number
          stage_id: string
          warnings: Json
        }
        Insert: {
          healed: Json
          is_incomplete: boolean
          original: Json
          source_line: number
          stage_id: string
          warnings?: Json
        }
        Update: {
          healed?: Json
          is_incomplete?: boolean
          original?: Json
          source_line?: number
          stage_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_stage_rows_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "import_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      import_stages: {
        Row: {
          approved_file_sha256: string | null
          approved_healer_version: string | null
          approved_rows_sha256: string | null
          blocked_count: number
          committed_batch_id: string | null
          correction_count: number
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          expires_at: string
          file_sha256: string
          filename: string
          healer_version: string
          id: string
          incomplete_count: number
          incomplete_input: number
          incomplete_selling: number
          kind: string
          private_count: number
          public_count: number
          repeat_acknowledged_at: string | null
          repeat_acknowledged_by: string | null
          repeat_of: Json | null
          row_count: number
          rows_sha256: string
          status: string
          summary: Json
          template_version: string
          total_input: number
          total_selling: number
          total_users: number
          uploaded_at: string
          uploaded_by: string
          warning_row_count: number
        }
        Insert: {
          approved_file_sha256?: string | null
          approved_healer_version?: string | null
          approved_rows_sha256?: string | null
          blocked_count?: number
          committed_batch_id?: string | null
          correction_count?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expires_at: string
          file_sha256: string
          filename: string
          healer_version: string
          id?: string
          incomplete_count: number
          incomplete_input?: number
          incomplete_selling?: number
          kind: string
          private_count: number
          public_count: number
          repeat_acknowledged_at?: string | null
          repeat_acknowledged_by?: string | null
          repeat_of?: Json | null
          row_count: number
          rows_sha256: string
          status: string
          summary?: Json
          template_version: string
          total_input: number
          total_selling: number
          total_users?: number
          uploaded_at?: string
          uploaded_by: string
          warning_row_count?: number
        }
        Update: {
          approved_file_sha256?: string | null
          approved_healer_version?: string | null
          approved_rows_sha256?: string | null
          blocked_count?: number
          committed_batch_id?: string | null
          correction_count?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          expires_at?: string
          file_sha256?: string
          filename?: string
          healer_version?: string
          id?: string
          incomplete_count?: number
          incomplete_input?: number
          incomplete_selling?: number
          kind?: string
          private_count?: number
          public_count?: number
          repeat_acknowledged_at?: string | null
          repeat_acknowledged_by?: string | null
          repeat_of?: Json | null
          row_count?: number
          rows_sha256?: string
          status?: string
          summary?: Json
          template_version?: string
          total_input?: number
          total_selling?: number
          total_users?: number
          uploaded_at?: string
          uploaded_by?: string
          warning_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_stages_committed_batch_id_fkey"
            columns: ["committed_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_batch_cost_runs: {
        Row: {
          actual_total: number | null
          avg_used: number | null
          created_at: string
          created_by: string | null
          details: Json | null
          error: string | null
          estimated_total: number | null
          id: string
          inputs_hash: string
          known_count: number | null
          lab_batch_id: string
          method: string
          missing_count: number | null
          status: string
          trigger: string
        }
        Insert: {
          actual_total?: number | null
          avg_used?: number | null
          created_at?: string
          created_by?: string | null
          details?: Json | null
          error?: string | null
          estimated_total?: number | null
          id?: string
          inputs_hash: string
          known_count?: number | null
          lab_batch_id: string
          method?: string
          missing_count?: number | null
          status: string
          trigger: string
        }
        Update: {
          actual_total?: number | null
          avg_used?: number | null
          created_at?: string
          created_by?: string | null
          details?: Json | null
          error?: string | null
          estimated_total?: number | null
          id?: string
          inputs_hash?: string
          known_count?: number | null
          lab_batch_id?: string
          method?: string
          missing_count?: number | null
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_batch_cost_runs_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "lab_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_batch_cost_runs_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "v_lab_batch_transaction_totals"
            referencedColumns: ["lab_batch_id"]
          },
        ]
      }
      lab_batch_invoices: {
        Row: {
          amount: number
          amount_inr: number
          created_at: string
          created_by: string | null
          currency: string
          fx_rate_to_inr: number | null
          id: string
          invoice_date: string
          invoice_ref: string | null
          is_final: boolean
          lab_batch_id: string
          note: string | null
          source: string
          status: string
          superseded_by: string | null
          vendor: string
        }
        Insert: {
          amount: number
          amount_inr: number
          created_at?: string
          created_by?: string | null
          currency: string
          fx_rate_to_inr?: number | null
          id?: string
          invoice_date: string
          invoice_ref?: string | null
          is_final?: boolean
          lab_batch_id: string
          note?: string | null
          source?: string
          status?: string
          superseded_by?: string | null
          vendor: string
        }
        Update: {
          amount?: number
          amount_inr?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate_to_inr?: number | null
          id?: string
          invoice_date?: string
          invoice_ref?: string | null
          is_final?: boolean
          lab_batch_id?: string
          note?: string | null
          source?: string
          status?: string
          superseded_by?: string | null
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_batch_invoices_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "lab_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_batch_invoices_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "v_lab_batch_transaction_totals"
            referencedColumns: ["lab_batch_id"]
          },
          {
            foreignKeyName: "lab_batch_invoices_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "lab_batch_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_batches: {
        Row: {
          actual_cost_total: number | null
          api_unit_label: string | null
          api_units_consumed: number | null
          auto_line_count: number | null
          batch_code: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          estimated_cost_total: number | null
          flags: string[]
          id: string
          known_line_count: number | null
          lab_type: string | null
          last_run_id: string | null
          license_seats_used: number | null
          name: string | null
          needs_recompute: boolean
          potential_id: string | null
          reopened_at: string | null
          reopened_by: string | null
          revenue_total: number | null
          status: string
          updated_at: string
          vm_hours_consumed: number | null
        }
        Insert: {
          actual_cost_total?: number | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          auto_line_count?: number | null
          batch_code: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_cost_total?: number | null
          flags?: string[]
          id?: string
          known_line_count?: number | null
          lab_type?: string | null
          last_run_id?: string | null
          license_seats_used?: number | null
          name?: string | null
          needs_recompute?: boolean
          potential_id?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          revenue_total?: number | null
          status?: string
          updated_at?: string
          vm_hours_consumed?: number | null
        }
        Update: {
          actual_cost_total?: number | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          auto_line_count?: number | null
          batch_code?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_cost_total?: number | null
          flags?: string[]
          id?: string
          known_line_count?: number | null
          lab_type?: string | null
          last_run_id?: string | null
          license_seats_used?: number | null
          name?: string | null
          needs_recompute?: boolean
          potential_id?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          revenue_total?: number | null
          status?: string
          updated_at?: string
          vm_hours_consumed?: number | null
        }
        Relationships: []
      }
      lab_catalog: {
        Row: {
          cloud_provider: string | null
          created_at: string
          created_by: string | null
          default_duration_days: number | null
          description: string | null
          document_url: string | null
          id: string
          lab_type: string
          line_of_business: string | null
          published_at: string | null
          published_by: string | null
          status: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
          updated_by: string | null
          vm_tier_id: string | null
        }
        Insert: {
          cloud_provider?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_days?: number | null
          description?: string | null
          document_url?: string | null
          id?: string
          lab_type: string
          line_of_business?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          updated_by?: string | null
          vm_tier_id?: string | null
        }
        Update: {
          cloud_provider?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_days?: number | null
          description?: string | null
          document_url?: string | null
          id?: string
          lab_type?: string
          line_of_business?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
          vm_tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_catalog_vm_tier_id_fkey"
            columns: ["vm_tier_id"]
            isOneToOne: false
            referencedRelation: "vm_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_transaction_cost_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string | null
          id: string
          new_actual_consumption: number | null
          new_credit_allocated: number | null
          new_input_cost: number | null
          new_selling_cost: number | null
          old_actual_consumption: number | null
          old_credit_allocated: number | null
          old_input_cost: number | null
          old_selling_cost: number | null
          reason: string
          transaction_id: string
        }
        Insert: {
          corrected_at?: string
          corrected_by?: string | null
          id?: string
          new_actual_consumption?: number | null
          new_credit_allocated?: number | null
          new_input_cost?: number | null
          new_selling_cost?: number | null
          old_actual_consumption?: number | null
          old_credit_allocated?: number | null
          old_input_cost?: number | null
          old_selling_cost?: number | null
          reason: string
          transaction_id: string
        }
        Update: {
          corrected_at?: string
          corrected_by?: string | null
          id?: string
          new_actual_consumption?: number | null
          new_credit_allocated?: number | null
          new_input_cost?: number | null
          new_selling_cost?: number | null
          old_actual_consumption?: number | null
          old_credit_allocated?: number | null
          old_input_cost?: number | null
          old_selling_cost?: number | null
          reason?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_transaction_cost_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_transaction_cost_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_lab_transaction_profit_breakdown"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "lab_transaction_cost_corrections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_revoked_clients: {
        Row: {
          client_id: string
          id: string
          revoked_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          id?: string
          revoked_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          id?: string
          revoked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_tool_audit_log: {
        Row: {
          arguments: Json
          client_id: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          success: boolean
          tool_name: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          arguments?: Json
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          success: boolean
          tool_name: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          arguments?: Json
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          success?: boolean
          tool_name?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      permission_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          id: string
          new_enabled: boolean | null
          new_sort_order: number | null
          old_enabled: boolean | null
          old_sort_order: number | null
          perm_key: string
          perm_kind: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          new_enabled?: boolean | null
          new_sort_order?: number | null
          old_enabled?: boolean | null
          old_sort_order?: number | null
          perm_key: string
          perm_kind: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          new_enabled?: boolean | null
          new_sort_order?: number | null
          old_enabled?: boolean | null
          old_sort_order?: number | null
          perm_key?: string
          perm_kind?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      report_snapshots: {
        Row: {
          cloud_provider: string
          cost: number
          created_at: string
          customer_name: string
          id: string
          lab_name: string
          line_of_business: string
          margin_pct: number
          month: number
          profit: number
          revenue: number
          run_id: string
          snapshot_date: string
          total_users: number
          transactions_count: number
          year: number
        }
        Insert: {
          cloud_provider: string
          cost?: number
          created_at?: string
          customer_name: string
          id?: string
          lab_name: string
          line_of_business: string
          margin_pct?: number
          month: number
          profit?: number
          revenue?: number
          run_id: string
          snapshot_date?: string
          total_users?: number
          transactions_count?: number
          year: number
        }
        Update: {
          cloud_provider?: string
          cost?: number
          created_at?: string
          customer_name?: string
          id?: string
          lab_name?: string
          line_of_business?: string
          margin_pct?: number
          month?: number
          profit?: number
          revenue?: number
          run_id?: string
          snapshot_date?: string
          total_users?: number
          transactions_count?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      role_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          target_email: string | null
          target_user_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          target_email?: string | null
          target_user_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          target_email?: string | null
          target_user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          key: string
          kind: string
          role: Database["public"]["Enums"]["app_role"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          kind: string
          role: Database["public"]["Enums"]["app_role"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          kind?: string
          role?: Database["public"]["Enums"]["app_role"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          created_at: string
          customers_count: number
          duration_ms: number | null
          error_message: string | null
          fetched_count: number | null
          finished_at: string | null
          id: string
          kind: string
          report_rows: number
          started_at: string
          status: string
          transactions_count: number
          trigger_source: string
          triggered_by: string | null
          triggered_by_email: string | null
          updated_at: string
          upserted_count: number | null
        }
        Insert: {
          created_at?: string
          customers_count?: number
          duration_ms?: number | null
          error_message?: string | null
          fetched_count?: number | null
          finished_at?: string | null
          id?: string
          kind?: string
          report_rows?: number
          started_at?: string
          status?: string
          transactions_count?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          updated_at?: string
          upserted_count?: number | null
        }
        Update: {
          created_at?: string
          customers_count?: number
          duration_ms?: number | null
          error_message?: string | null
          fetched_count?: number | null
          finished_at?: string | null
          id?: string
          kind?: string
          report_rows?: number
          started_at?: string
          status?: string
          transactions_count?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          updated_at?: string
          upserted_count?: number | null
        }
        Relationships: []
      }
      ticket_action_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          resolution_note: string | null
          ticket_id: number
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          resolution_note?: string | null
          ticket_id: number
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          resolution_note?: string | null
          ticket_id?: number
        }
        Relationships: []
      }
      transaction_activity_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          transaction_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          transaction_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_activity_log_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_activity_log_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_lab_transaction_profit_breakdown"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_activity_log_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          created_at: string
          created_by: string | null
          tag: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          tag: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          tag?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_lab_transaction_profit_breakdown"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          addon_revenue_total: number | null
          api_key_price_per_user: number | null
          api_key_service: string | null
          api_unit_label: string | null
          api_units_consumed: number | null
          cloud_provider: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          end_date: string | null
          id: string
          import_batch_id: string | null
          input_cost: number | null
          input_cost_actual_alloc: number | null
          input_cost_auto: number | null
          input_cost_auto_run_id: string | null
          input_cost_pct: number | null
          input_cost_per_user: number | null
          is_complete: boolean | null
          is_deleted: boolean
          lab_batch_id: string | null
          lab_name: string | null
          lab_type: string
          license_name: string | null
          license_price_per_user: number | null
          license_seats_used: number | null
          line_of_business: string | null
          month: number | null
          potential_id: string | null
          public_actual_consumption: number | null
          public_credit_allocated: number | null
          public_service_margin: number | null
          public_total_margin_actual: number | null
          public_unused_credit: number | null
          repository_type: string
          selling_cost: number | null
          selling_price_per_user: number | null
          source_line: number | null
          start_date: string | null
          system_config: string | null
          total_users: number | null
          updated_at: string
          updated_by: string | null
          vm_hours_consumed: number | null
          vm_price_per_user: number | null
          year: number | null
        }
        Insert: {
          addon_revenue_total?: number | null
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          cloud_provider?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          end_date?: string | null
          id?: string
          import_batch_id?: string | null
          input_cost?: number | null
          input_cost_actual_alloc?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean
          lab_batch_id?: string | null
          lab_name?: string | null
          lab_type: string
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          public_service_margin?: number | null
          public_total_margin_actual?: number | null
          public_unused_credit?: number | null
          repository_type: string
          selling_cost?: number | null
          selling_price_per_user?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string
          updated_by?: string | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          year?: number | null
        }
        Update: {
          addon_revenue_total?: number | null
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          cloud_provider?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          end_date?: string | null
          id?: string
          import_batch_id?: string | null
          input_cost?: number | null
          input_cost_actual_alloc?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean
          lab_batch_id?: string | null
          lab_name?: string | null
          lab_type?: string
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          public_service_margin?: number | null
          public_total_margin_actual?: number | null
          public_unused_credit?: number | null
          repository_type?: string
          selling_cost?: number | null
          selling_price_per_user?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string
          updated_by?: string | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "lab_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "v_lab_batch_transaction_totals"
            referencedColumns: ["lab_batch_id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          stage_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          stage_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          stage_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "import_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vm_tiers: {
        Row: {
          code: string
          currency: string
          id: string
          internal_cost_per_day: number | null
          is_active: boolean
          price_per_day: number | null
          ram_gb: number
          selling_price_per_day: number | null
          sort_order: number
          storage_gb: number | null
          updated_at: string
          updated_by: string | null
          vcpu: number
        }
        Insert: {
          code: string
          currency?: string
          id?: string
          internal_cost_per_day?: number | null
          is_active?: boolean
          price_per_day?: number | null
          ram_gb: number
          selling_price_per_day?: number | null
          sort_order?: number
          storage_gb?: number | null
          updated_at?: string
          updated_by?: string | null
          vcpu: number
        }
        Update: {
          code?: string
          currency?: string
          id?: string
          internal_cost_per_day?: number | null
          is_active?: boolean
          price_per_day?: number | null
          ram_gb?: number
          selling_price_per_day?: number | null
          sort_order?: number
          storage_gb?: number | null
          updated_at?: string
          updated_by?: string | null
          vcpu?: number
        }
        Relationships: []
      }
    }
    Views: {
      v_lab_batch_transaction_totals: {
        Row: {
          actual_cost_total_derived: number | null
          auto_line_count_derived: number | null
          estimated_cost_total_derived: number | null
          known_line_count_derived: number | null
          lab_batch_id: string | null
          line_count_derived: number | null
          revenue_total_derived: number | null
        }
        Relationships: []
      }
      v_lab_transaction_profit_breakdown: {
        Row: {
          effective_cost: number | null
          input_cost_locked: number | null
          lab_batch_id: string | null
          lab_type: string | null
          public_actual_consumption: number | null
          public_credit_allocated: number | null
          selling_cost: number | null
          service_margin: number | null
          total_profit_actual: number | null
          transaction_id: string | null
          unused_credit: number | null
        }
        Insert: {
          effective_cost?: never
          input_cost_locked?: number | null
          lab_batch_id?: string | null
          lab_type?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          selling_cost?: number | null
          service_margin?: number | null
          total_profit_actual?: number | null
          transaction_id?: string | null
          unused_credit?: number | null
        }
        Update: {
          effective_cost?: never
          input_cost_locked?: number | null
          lab_batch_id?: string | null
          lab_type?: string | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          selling_cost?: number | null
          service_margin?: number | null
          total_profit_actual?: number | null
          transaction_id?: string | null
          unused_credit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "lab_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_lab_batch_id_fkey"
            columns: ["lab_batch_id"]
            isOneToOne: false
            referencedRelation: "v_lab_batch_transaction_totals"
            referencedColumns: ["lab_batch_id"]
          },
        ]
      }
      v_transaction_costs: {
        Row: {
          cost_effective: number | null
          cost_source: string | null
          id: string | null
        }
        Insert: {
          cost_effective?: never
          cost_source?: never
          id?: string | null
        }
        Update: {
          cost_effective?: never
          cost_source?: never
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _assert_batch_closer: { Args: never; Returns: undefined }
      add_vm_tier: {
        Args: {
          p_code: string
          p_internal_cost_per_day: number
          p_ram_gb: number
          p_reason: string
          p_selling_price_per_day: number
          p_storage_gb: number
          p_vcpu: number
        }
        Returns: string
      }
      admin_correct_lab_transaction_costs: {
        Args: {
          p_input_cost: number
          p_public_actual_consumption?: number
          p_public_credit_allocated?: number
          p_reason?: string
          p_selling_cost: number
          p_transaction_id: string
        }
        Returns: undefined
      }
      approve_import: {
        Args: {
          p_file_sha256: string
          p_reason?: string
          p_rows_sha256: string
          p_stage_id: string
        }
        Returns: Json
      }
      cancel_import: { Args: { p_stage_id: string }; Returns: undefined }
      canonical_cloud_provider: {
        Args: { p_provider: string }
        Returns: string
      }
      claim_ai_cc_worker_slot: {
        Args: { p_worker_id: string }
        Returns: {
          agent_key: string
          current_load: number
          id: string
          last_assigned_at: string
        }[]
      }
      clean_customer_name: { Args: { p_name: string }; Returns: string }
      clear_bulk_import_artifact_paths: {
        Args: { _run_ids: string[] }
        Returns: number
      }
      close_lab_batch: { Args: { p_batch_id: string }; Returns: Json }
      cloud_provider_key: { Args: { p_value: string }; Returns: string }
      cloud_provider_rule: {
        Args: { p_provider: string }
        Returns: {
          cloud_type: string
          provider: string
        }[]
      }
      cloud_type_for_provider: { Args: { p_provider: string }; Returns: string }
      commit_import: { Args: { p_stage_id: string }; Returns: Json }
      expire_import_stages: { Args: never; Returns: number }
      expired_bulk_import_artifacts: {
        Args: { _days: number }
        Returns: {
          error_artifact_path: string
          original_csv_path: string
          run_id: string
        }[]
      }
      fuzzy_search_transactions: {
        Args: { max_rows?: number; q: string; threshold?: number }
        Returns: {
          id: string
          score: number
        }[]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_approval_status: { Args: never; Returns: Json }
      import_healer_rules: { Args: never; Returns: string[] }
      import_row_is_incomplete: { Args: { p_row: Json }; Returns: boolean }
      import_rows_sha256: { Args: { p_stage_id: string }; Returns: string }
      import_settings_operator: { Args: never; Returns: boolean }
      import_stage_approvers: { Args: never; Returns: string[] }
      import_stage_people: { Args: { p_stage_ids: string[] }; Returns: Json }
      import_stage_summary: {
        Args: { p_client: Json; p_healer_version: string; p_stage: string }
        Returns: Json
      }
      import_transactions_batch: {
        Args: {
          p_customer_names: Json
          p_file_sha256: string
          p_filename: string
          p_kind: string
          p_rows: Json
          p_template_version: string
        }
        Returns: Json
      }
      import_values_match: {
        Args: { p_reported: string; p_staged: string }
        Returns: boolean
      }
      is_blank_text: { Args: { p: string }; Returns: boolean }
      is_import_approver: { Args: { p_uid: string }; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      normalize_customer_name: { Args: { p_name: string }; Returns: string }
      pending_import_count: { Args: never; Returns: number }
      recompute_dirty_lab_batches: { Args: never; Returns: Json }
      recompute_lab_batch_costs: {
        Args: { p_batch_id: string; p_trigger: string }
        Returns: Json
      }
      record_lab_batch_invoice: {
        Args: {
          p_amount: number
          p_batch_id: string
          p_currency: string
          p_fx: number
          p_invoice_date: string
          p_invoice_ref: string
          p_note: string
          p_source: string
          p_vendor: string
        }
        Returns: Json
      }
      reject_import: {
        Args: { p_reason?: string; p_stage_id: string }
        Returns: undefined
      }
      release_ai_cc_worker_slot: {
        Args: { p_worker_id: string }
        Returns: {
          current_load: number
          id: string
        }[]
      }
      reopen_lab_batch: { Args: { p_batch_id: string }; Returns: Json }
      request_lab_batch_recompute: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      save_cost_rate: {
        Args: { p_key: string; p_reason: string; p_value: number }
        Returns: undefined
      }
      save_vm_tier: {
        Args: {
          p_id: string
          p_internal_cost_per_day: number
          p_is_active: boolean
          p_price_per_day: number
          p_reason: string
          p_selling_price_per_day: number
        }
        Returns: undefined
      }
      set_import_approvers: {
        Args: { p_approver_user_ids: string[] }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stage_import:
        | {
            Args: {
              p_corrections: Json
              p_file_sha256: string
              p_filename: string
              p_healer_version: string
              p_kind: string
              p_rows: Json
              p_summary: Json
              p_template_version: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_acknowledge_repeat: boolean
              p_corrections: Json
              p_file_sha256: string
              p_filename: string
              p_healer_version: string
              p_kind: string
              p_rows: Json
              p_summary: Json
              p_template_version: string
            }
            Returns: Json
          }
      supersede_lab_batch_invoice: {
        Args: {
          p_amount: number
          p_currency: string
          p_fx: number
          p_invoice_date: string
          p_invoice_id: string
          p_invoice_ref: string
          p_note: string
          p_source: string
          p_vendor: string
        }
        Returns: Json
      }
      update_import_approval_settings: {
        Args: {
          p_approver_roles: Database["public"]["Enums"]["app_role"][]
          p_approver_user_ids: string[]
          p_repeat_file_check: string
          p_stage_ttl: string
        }
        Returns: undefined
      }
      verify_cron_secret: { Args: { _token: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "leadership"
        | "finance"
        | "ops_lead"
        | "ops_user"
        | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "leadership",
        "finance",
        "ops_lead",
        "ops_user",
        "viewer",
      ],
    },
  },
} as const
