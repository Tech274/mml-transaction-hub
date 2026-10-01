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
      ai_agent_eval_runs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          pass_rate: number
          results: Json
          safety_pass: boolean
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          pass_rate: number
          results: Json
          safety_pass: boolean
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          pass_rate?: number
          results?: Json
          safety_pass?: boolean
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_eval_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_evals: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          expectations: Json
          id: string
          input: Json
          is_safety: boolean
          name: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          expectations?: Json
          id?: string
          input: Json
          is_safety?: boolean
          name: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          expectations?: Json
          id?: string
          input?: Json
          is_safety?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_evals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_run_steps: {
        Row: {
          cost_usd_est: number
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          input_redacted: Json
          kind: string
          name: string
          output_redacted: Json
          run_id: string
          seq: number
          status: string
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          cost_usd_est?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          input_redacted?: Json
          kind: string
          name: string
          output_redacted?: Json
          run_id: string
          seq: number
          status: string
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          cost_usd_est?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          input_redacted?: Json
          kind?: string
          name?: string
          output_redacted?: Json
          run_id?: string
          seq?: number
          status?: string
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_runs: {
        Row: {
          agent_id: string
          cost_usd_est: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          invoked_by: string | null
          model_id: string | null
          run_as: string
          started_at: string
          status: string
          tokens_in: number
          tokens_out: number
          trigger_kind: string
          trigger_ref: Json
          version_id: string
          view_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          agent_id: string
          cost_usd_est?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          invoked_by?: string | null
          model_id?: string | null
          run_as?: string
          started_at?: string
          status: string
          tokens_in?: number
          tokens_out?: number
          trigger_kind: string
          trigger_ref?: Json
          version_id: string
          view_roles: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          agent_id?: string
          cost_usd_est?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          invoked_by?: string | null
          model_id?: string | null
          run_as?: string
          started_at?: string
          status?: string
          tokens_in?: number
          tokens_out?: number
          trigger_kind?: string
          trigger_ref?: Json
          version_id?: string
          view_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_tools: {
        Row: {
          params: Json
          tool_key: string
          version_id: string
        }
        Insert: {
          params?: Json
          tool_key: string
          version_id: string
        }
        Update: {
          params?: Json
          tool_key?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_tools_tool_key_fkey"
            columns: ["tool_key"]
            isOneToOne: false
            referencedRelation: "ai_tool_catalog"
            referencedColumns: ["tool_key"]
          },
          {
            foreignKeyName: "ai_agent_tools_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_versions: {
        Row: {
          agent_id: string
          approve_roles: Database["public"]["Enums"]["app_role"][]
          change_note: string | null
          created_at: string
          created_by: string | null
          eval_status: string
          id: string
          instructions: string
          limits: Json
          max_output_tokens: number
          model_id: string | null
          model_provider: string
          output_types: string[]
          premium_approved: boolean
          purpose: string
          run_roles: Database["public"]["Enums"]["app_role"][]
          temperature: number
          triggers: Json
          version: number
          view_roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          agent_id: string
          approve_roles?: Database["public"]["Enums"]["app_role"][]
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          eval_status?: string
          id?: string
          instructions?: string
          limits?: Json
          max_output_tokens?: number
          model_id?: string | null
          model_provider?: string
          output_types?: string[]
          premium_approved?: boolean
          purpose?: string
          run_roles?: Database["public"]["Enums"]["app_role"][]
          temperature?: number
          triggers?: Json
          version: number
          view_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          agent_id?: string
          approve_roles?: Database["public"]["Enums"]["app_role"][]
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          eval_status?: string
          id?: string
          instructions?: string
          limits?: Json
          max_output_tokens?: number
          model_id?: string | null
          model_provider?: string
          output_types?: string[]
          premium_approved?: boolean
          purpose?: string
          run_roles?: Database["public"]["Enums"]["app_role"][]
          temperature?: number
          triggers?: Json
          version?: number
          view_roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_versions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          created_at: string
          current_version_id: string | null
          engine: string
          id: string
          is_system: boolean
          key: string
          name: string
          owner_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          engine: string
          id?: string
          is_system?: boolean
          key: string
          name: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          engine?: string
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_prices: {
        Row: {
          input_per_mtok_usd: number
          model_id: string
          output_per_mtok_usd: number
          provider: string
          source_url: string | null
          valid_from: string
        }
        Insert: {
          input_per_mtok_usd: number
          model_id: string
          output_per_mtok_usd: number
          provider: string
          source_url?: string | null
          valid_from: string
        }
        Update: {
          input_per_mtok_usd?: number
          model_id?: string
          output_per_mtok_usd?: number
          provider?: string
          source_url?: string | null
          valid_from?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          agents_enabled: boolean
          id: number
          monthly_cap_usd: number
          per_agent_month_cap_usd: number
          per_run_cap_usd: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agents_enabled?: boolean
          id: number
          monthly_cap_usd?: number
          per_agent_month_cap_usd?: number
          per_run_cap_usd?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agents_enabled?: boolean
          id?: number
          monthly_cap_usd?: number
          per_agent_month_cap_usd?: number
          per_run_cap_usd?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_tool_catalog: {
        Row: {
          description: string
          enabled: boolean
          phase: number
          reads_untrusted: boolean
          required_roles: Database["public"]["Enums"]["app_role"][]
          returns_money: boolean
          title: string
          tool_key: string
        }
        Insert: {
          description: string
          enabled?: boolean
          phase: number
          reads_untrusted?: boolean
          required_roles: Database["public"]["Enums"]["app_role"][]
          returns_money?: boolean
          title: string
          tool_key: string
        }
        Update: {
          description?: string
          enabled?: boolean
          phase?: number
          reads_untrusted?: boolean
          required_roles?: Database["public"]["Enums"]["app_role"][]
          returns_money?: boolean
          title?: string
          tool_key?: string
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
          agent_version_id: string | null
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
          agent_version_id?: string | null
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
          agent_version_id?: string | null
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
          agent_run_id: string | null
          agent_version_id: string | null
          ai_generated: boolean
          approve_roles: Database["public"]["Enums"]["app_role"][] | null
          contains_money: boolean
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_email: string | null
          decision_note: string | null
          id: string
          item_type: string
          model_id: string | null
          payload: Json
          run_id: string | null
          status: string
          summary: string | null
          title: string
          view_roles: Database["public"]["Enums"]["app_role"][] | null
        }
        Insert: {
          agent_key: string
          agent_run_id?: string | null
          agent_version_id?: string | null
          ai_generated?: boolean
          approve_roles?: Database["public"]["Enums"]["app_role"][] | null
          contains_money?: boolean
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_email?: string | null
          decision_note?: string | null
          id?: string
          item_type: string
          model_id?: string | null
          payload?: Json
          run_id?: string | null
          status?: string
          summary?: string | null
          title: string
          view_roles?: Database["public"]["Enums"]["app_role"][] | null
        }
        Update: {
          agent_key?: string
          agent_run_id?: string | null
          agent_version_id?: string | null
          ai_generated?: boolean
          approve_roles?: Database["public"]["Enums"]["app_role"][] | null
          contains_money?: boolean
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_email?: string | null
          decision_note?: string | null
          id?: string
          item_type?: string
          model_id?: string | null
          payload?: Json
          run_id?: string | null
          status?: string
          summary?: string | null
          title?: string
          view_roles?: Database["public"]["Enums"]["app_role"][] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_cc_inbox_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_cc_inbox_agent_version_id_fkey"
            columns: ["agent_version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
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
      import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          file_sha256: string
          filename: string
          id: string
          kind: string
          row_count: number
          status: string
          template_version: string
          total_input: number
          total_selling: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_sha256: string
          filename: string
          id?: string
          kind: string
          row_count: number
          status?: string
          template_version: string
          total_input: number
          total_selling: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_sha256?: string
          filename?: string
          id?: string
          kind?: string
          row_count?: number
          status?: string
          template_version?: string
          total_input?: number
          total_selling?: number
        }
        Relationships: []
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
        ]
      }
      transactions: {
        Row: {
          cloud_provider: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          end_date: string | null
          id: string
          import_batch_id: string | null
          input_cost: number | null
          addon_revenue_total: number | null
          api_key_price_per_user: number | null
          api_key_service: string | null
          api_unit_label: string | null
          api_units_consumed: number | null
          input_cost_actual_alloc: number | null
          input_cost_auto: number | null
          input_cost_auto_run_id: string | null
          input_cost_pct: number | null
          input_cost_per_user: number | null
          is_complete: boolean | null
          lab_batch_id: string | null
          license_name: string | null
          license_price_per_user: number | null
          license_seats_used: number | null
          public_actual_consumption: number | null
          public_credit_allocated: number | null
          public_service_margin: number | null
          public_total_margin_actual: number | null
          public_unused_credit: number | null
          selling_price_per_user: number | null
          vm_hours_consumed: number | null
          vm_price_per_user: number | null
          is_deleted: boolean
          lab_name: string | null
          lab_type: string
          line_of_business: string | null
          month: number | null
          potential_id: string | null
          repository_type: string
          selling_cost: number | null
          source_line: number | null
          start_date: string | null
          system_config: string | null
          total_users: number | null
          updated_at: string
          updated_by: string | null
          year: number | null
        }
        Insert: {
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
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean
          lab_batch_id?: string | null
          lab_name?: string | null
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          selling_price_per_user?: number | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          lab_type: string
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          repository_type: string
          selling_cost?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string
          updated_by?: string | null
          year?: number | null
        }
        Update: {
          cloud_provider?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          end_date?: string | null
          id?: string
          import_batch_id?: string | null
          input_cost?: number | null
          api_key_price_per_user?: number | null
          api_key_service?: string | null
          api_unit_label?: string | null
          api_units_consumed?: number | null
          input_cost_actual_alloc?: number | null
          input_cost_auto?: number | null
          input_cost_auto_run_id?: string | null
          input_cost_pct?: number | null
          input_cost_per_user?: number | null
          is_complete?: boolean | null
          is_deleted?: boolean
          lab_batch_id?: string | null
          lab_name?: string | null
          license_name?: string | null
          license_price_per_user?: number | null
          license_seats_used?: number | null
          selling_price_per_user?: number | null
          vm_hours_consumed?: number | null
          vm_price_per_user?: number | null
          lab_type?: string
          line_of_business?: string | null
          month?: number | null
          potential_id?: string | null
          repository_type?: string
          selling_cost?: number | null
          source_line?: number | null
          start_date?: string | null
          system_config?: string | null
          total_users?: number | null
          updated_at?: string
          updated_by?: string | null
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
        ]
      }
      vm_tiers: {
        Row: {
          id: string
          code: string
          vcpu: number
          ram_gb: number
          storage_gb: number | null
          price_per_day: number | null
          selling_price_per_day: number | null
          internal_cost_per_day: number | null
          currency: string
          is_active: boolean
          sort_order: number
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          vcpu: number
          ram_gb: number
          storage_gb?: number | null
          price_per_day?: number | null
          selling_price_per_day?: number | null
          internal_cost_per_day?: number | null
          currency?: string
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          code?: string
          price_per_day?: number | null
          selling_price_per_day?: number | null
          internal_cost_per_day?: number | null
          is_active?: boolean
        }
        Relationships: []
      }
      cost_rates: {
        Row: { key: string; value: number | null; unit: string; currency: string; updated_by: string | null; updated_at: string }
        Insert: { key: string; value?: number | null; unit: string; currency?: string }
        Update: { value?: number | null; updated_by?: string | null; updated_at?: string }
        Relationships: []
      }
      catalog_audit_log: {
        Row: { id: string; table_name: string; row_key: string; field_name: string; old_value: string | null; new_value: string | null; reason: string | null; changed_by: string | null; changed_at: string }
        Insert: { id?: string; table_name: string; row_key: string; field_name: string; old_value?: string | null; new_value?: string | null; reason?: string | null }
        Update: { reason?: string | null }
        Relationships: []
      }
      lab_catalog: {
        Row: {
          id: string; title: string; summary: string | null; description: string | null; lab_type: string;
          cloud_provider: string | null; vm_tier_id: string | null; default_duration_days: number | null;
          line_of_business: string | null; tags: string[]; document_url: string | null; status: string;
          published_at: string | null; published_by: string | null; created_by: string | null; updated_by: string | null;
          created_at: string; updated_at: string
        }
        Insert: {
          id?: string; title: string; summary?: string | null; description?: string | null; lab_type: string;
          cloud_provider?: string | null; vm_tier_id?: string | null; default_duration_days?: number | null;
          line_of_business?: string | null; tags?: string[]; document_url?: string | null; status?: string
        }
        Update: {
          title?: string; summary?: string | null; description?: string | null; lab_type?: string;
          cloud_provider?: string | null; vm_tier_id?: string | null; default_duration_days?: number | null;
          line_of_business?: string | null; tags?: string[]; document_url?: string | null; status?: string;
          published_at?: string | null; published_by?: string | null
        }
        Relationships: []
      }
      lab_batches: {
        Row: {
          id: string; batch_code: string; name: string | null; potential_id: string | null; lab_type: string | null;
          currency: string; status: string; revenue_total: number | null; estimated_cost_total: number | null;
          actual_cost_total: number | null; known_line_count: number | null; auto_line_count: number | null;
          flags: string[]; needs_recompute: boolean; last_run_id: string | null; closed_at: string | null;
          closed_by: string | null; reopened_at: string | null; reopened_by: string | null;
          vm_hours_consumed: number | null; license_seats_used: number | null; api_units_consumed: number | null;
          api_unit_label: string | null; created_by: string | null; created_at: string; updated_at: string
        }
        Insert: { id?: string; batch_code?: string; name?: string | null; lab_type?: string | null; currency?: string; status?: string; created_by?: string | null }
        Update: { name?: string | null; status?: string; needs_recompute?: boolean }
        Relationships: []
      }
      lab_batch_invoices: {
        Row: {
          id: string; lab_batch_id: string; vendor: string; invoice_ref: string | null; invoice_date: string;
          currency: string; amount: number; fx_rate_to_inr: number | null; amount_inr: number; is_final: boolean;
          source: string; status: string; superseded_by: string | null; note: string | null; created_by: string | null; created_at: string
        }
        Insert: { lab_batch_id: string; vendor: string; invoice_date: string; currency: string; amount: number; amount_inr: number; fx_rate_to_inr?: number | null; source?: string }
        Update: { status?: string; superseded_by?: string | null }
        Relationships: []
      }
      lab_batch_cost_runs: {
        Row: { id: string; lab_batch_id: string; trigger: string; inputs_hash: string; status: string; known_count: number | null; missing_count: number | null; avg_used: number | null; method: string; estimated_total: number | null; actual_total: number | null; details: Json | null; error: string | null; created_by: string | null; created_at: string }
        Insert: { lab_batch_id: string; trigger: string; inputs_hash: string; status: string }
        Update: { status?: string }
        Relationships: []
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
        ]
      }
      transaction_tags: {
        Row: { transaction_id: string; tag: string; created_by: string | null; created_at: string }
        Insert: { transaction_id: string; tag: string; created_by?: string | null }
        Update: { tag?: string }
        Relationships: []
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
    }
    Views: {
      ai_usage_monthly: {
        Row: {
          agent_key: string
          budget_blocked: number
          cost_usd_est: number
          errors: number
          model_id: string
          month: string
          runs: number
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          agent_key?: string
          budget_blocked?: number
          cost_usd_est?: number
          errors?: number
          model_id?: string
          month?: string
          runs?: number
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          agent_key?: string
          budget_blocked?: number
          cost_usd_est?: number
          errors?: number
          model_id?: string
          month?: string
          runs?: number
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: []
      }
      v_lab_batch_transaction_totals: {
        Row: {
          actual_cost_total_derived: number | null
          auto_line_count_derived: number
          estimated_cost_total_derived: number
          known_line_count_derived: number
          lab_batch_id: string
          line_count_derived: number
          revenue_total_derived: number
        }
        Insert: {
          actual_cost_total_derived?: number | null
          auto_line_count_derived?: number
          estimated_cost_total_derived?: number
          known_line_count_derived?: number
          lab_batch_id?: string
          line_count_derived?: number
          revenue_total_derived?: number
        }
        Update: {
          actual_cost_total_derived?: number | null
          auto_line_count_derived?: number
          estimated_cost_total_derived?: number
          known_line_count_derived?: number
          lab_batch_id?: string
          line_count_derived?: number
          revenue_total_derived?: number
        }
        Relationships: []
      }
      v_lab_transaction_profit_breakdown: {
        Row: {
          effective_cost: number | null
          input_cost_locked: number | null
          lab_batch_id: string | null
          lab_type: string
          public_actual_consumption: number | null
          public_credit_allocated: number | null
          selling_cost: number | null
          service_margin: number | null
          total_profit_actual: number | null
          transaction_id: string
          unused_credit: number | null
        }
        Insert: {
          effective_cost?: number | null
          input_cost_locked?: number | null
          lab_batch_id?: string | null
          lab_type?: string
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          selling_cost?: number | null
          service_margin?: number | null
          total_profit_actual?: number | null
          transaction_id?: string
          unused_credit?: number | null
        }
        Update: {
          effective_cost?: number | null
          input_cost_locked?: number | null
          lab_batch_id?: string | null
          lab_type?: string
          public_actual_consumption?: number | null
          public_credit_allocated?: number | null
          selling_cost?: number | null
          service_margin?: number | null
          total_profit_actual?: number | null
          transaction_id?: string
          unused_credit?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_agents_for_me: {
        Args: never
        Returns: {
          engine: string
          id: string
          key: string
          name: string
          purpose: string
          status: string
        }[]
      }
      ai_reject_mutation: {
        Args: never
        Returns: unknown
      }
      admin_correct_lab_transaction_costs: {
        Args: {
          p_input_cost: number
          p_public_actual_consumption?: number | null
          p_public_credit_allocated?: number | null
          p_reason?: string | null
          p_selling_cost: number
          p_transaction_id: string
        }
        Returns: undefined
      }
      claim_ai_cc_worker_slot: {
        Args: { p_worker_id: string }
        Returns: {
          agent_key: string
          current_load: number
          id: string
          last_assigned_at: string | null
        }[]
      }
      clean_customer_name: { Args: { p_name: string }; Returns: string }
      clear_bulk_import_artifact_paths: {
        Args: { _run_ids: string[] }
        Returns: number
      }
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
      normalize_customer_name: { Args: { p_name: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      verify_cron_secret: { Args: { _token: string }; Returns: boolean }
      save_cost_rate: { Args: { p_key: string; p_value: number | null; p_reason: string }; Returns: undefined }
      save_vm_tier: { Args: { p_id: string; p_price_per_day: number | null; p_selling_price_per_day: number | null; p_internal_cost_per_day: number | null; p_is_active: boolean; p_reason: string }; Returns: undefined }
      add_vm_tier: { Args: { p_code: string; p_vcpu: number; p_ram_gb: number; p_storage_gb: number; p_selling_price_per_day: number | null; p_internal_cost_per_day: number | null; p_reason: string }; Returns: string }
      close_lab_batch: { Args: { p_batch_id: string }; Returns: Json }
      reopen_lab_batch: { Args: { p_batch_id: string }; Returns: Json }
      request_lab_batch_recompute: { Args: { p_batch_id: string }; Returns: Json }
      record_lab_batch_invoice: { Args: { p_batch_id: string; p_vendor: string; p_invoice_ref: string; p_invoice_date: string; p_currency: string; p_amount: number; p_fx: number | null; p_source: string; p_note: string | null }; Returns: Json }
      recompute_lab_batch_costs: { Args: { p_batch_id: string; p_trigger: string }; Returns: Json }
      release_ai_cc_worker_slot: {
        Args: { p_worker_id: string }
        Returns: {
          current_load: number
          id: string
        }[]
      }
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
