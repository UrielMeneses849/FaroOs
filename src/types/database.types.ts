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
      content_campaigns: {
        Row: {
          created_at: string
          ends_on: string | null
          id: string
          name: string
          objective: string | null
          starts_on: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          id?: string
          name: string
          objective?: string | null
          starts_on?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          id?: string
          name?: string
          objective?: string | null
          starts_on?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_channels: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      content_items: {
        Row: {
          campaign_id: string | null
          channel_id: string | null
          created_at: string
          cta: string | null
          format: string
          id: string
          idea: string | null
          notes: string | null
          objective: string | null
          portfolio_case_study_id: string | null
          publish_at: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          cta?: string | null
          format: string
          id?: string
          idea?: string | null
          notes?: string | null
          objective?: string | null
          portfolio_case_study_id?: string | null
          publish_at?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          cta?: string | null
          format?: string
          id?: string
          idea?: string | null
          notes?: string | null
          objective?: string | null
          portfolio_case_study_id?: string | null
          publish_at?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "content_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "content_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_accounts: {
        Row: {
          closing_day: number | null
          created_at: string
          credit_limit: number | null
          currency: string
          id: string
          initial_balance: number
          is_active: boolean
          name: string
          payment_day: number | null
          type: Database["public"]["Enums"]["finance_account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          closing_day?: number | null
          created_at?: string
          credit_limit?: number | null
          currency?: string
          id?: string
          initial_balance?: number
          is_active?: boolean
          name: string
          payment_day?: number | null
          type: Database["public"]["Enums"]["finance_account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          closing_day?: number | null
          created_at?: string
          credit_limit?: number | null
          currency?: string
          id?: string
          initial_balance?: number
          is_active?: boolean
          name?: string
          payment_day?: number | null
          type?: Database["public"]["Enums"]["finance_account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_budgets: {
        Row: {
          category_id: string
          created_at: string
          id: string
          month: string
          planned_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          month: string
          planned_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          month?: string
          planned_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_budgets_category_id_user_id_fkey"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      finance_categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          type: Database["public"]["Enums"]["finance_category_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          type: Database["public"]["Enums"]["finance_category_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          type?: Database["public"]["Enums"]["finance_category_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_goal_contributions: {
        Row: {
          account_id: string | null
          amount: number
          contribution_date: string
          contribution_source: string
          created_at: string
          description: string | null
          goal_id: string
          id: string
          notes: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          contribution_date: string
          contribution_source?: string
          created_at?: string
          description?: string | null
          goal_id: string
          id?: string
          notes?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          contribution_date?: string
          contribution_source?: string
          created_at?: string
          description?: string | null
          goal_id?: string
          id?: string
          notes?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goal_contributions_account_id_user_id_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_goal_contributions_goal_id_user_id_fkey"
            columns: ["goal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_goals"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_goal_contributions_transaction_id_user_id_fkey"
            columns: ["transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      finance_goals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          linked_account_id: string | null
          name: string
          priority: Database["public"]["Enums"]["finance_goal_priority"]
          status: Database["public"]["Enums"]["finance_goal_status"]
          target_amount: number
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          linked_account_id?: string | null
          name: string
          priority?: Database["public"]["Enums"]["finance_goal_priority"]
          status?: Database["public"]["Enums"]["finance_goal_status"]
          target_amount: number
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          linked_account_id?: string | null
          name?: string
          priority?: Database["public"]["Enums"]["finance_goal_priority"]
          status?: Database["public"]["Enums"]["finance_goal_status"]
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goals_linked_account_id_user_id_fkey"
            columns: ["linked_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      finance_recurring_occurrences: {
        Row: {
          amount: number | null
          created_at: string
          expected_date: string
          id: string
          paid_at: string | null
          period: string
          previous_next_date: string | null
          recurring_transaction_id: string
          skipped_at: string | null
          status: Database["public"]["Enums"]["finance_recurring_occurrence_status"]
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          expected_date: string
          id?: string
          paid_at?: string | null
          period: string
          previous_next_date?: string | null
          recurring_transaction_id: string
          skipped_at?: string | null
          status?: Database["public"]["Enums"]["finance_recurring_occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          expected_date?: string
          id?: string
          paid_at?: string | null
          period?: string
          previous_next_date?: string | null
          recurring_transaction_id?: string
          skipped_at?: string | null
          status?: Database["public"]["Enums"]["finance_recurring_occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_recurring_occurrences_recurring_transaction_id_use_fkey"
            columns: ["recurring_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_recurring_transactions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_recurring_occurrences_transaction_id_user_id_fkey"
            columns: ["transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      finance_recurring_transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          day_of_month: number | null
          description: string
          destination_account_id: string | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["finance_frequency"]
          id: string
          is_active: boolean
          next_occurrence: string
          start_date: string
          type: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          description: string
          destination_account_id?: string | null
          end_date?: string | null
          frequency: Database["public"]["Enums"]["finance_frequency"]
          id?: string
          is_active?: boolean
          next_occurrence: string
          start_date: string
          type: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          description?: string
          destination_account_id?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["finance_frequency"]
          id?: string
          is_active?: boolean
          next_occurrence?: string
          start_date?: string
          type?: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_recurring_transaction_destination_account_id_user__fkey"
            columns: ["destination_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_recurring_transactions_account_id_user_id_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_recurring_transactions_category_id_user_id_fkey"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          description: string
          destination_account_id: string | null
          id: string
          legacy_transaction_id: string | null
          notes: string | null
          recurring_transaction_id: string | null
          status: Database["public"]["Enums"]["finance_transaction_status"]
          transaction_date: string
          type: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          description: string
          destination_account_id?: string | null
          id?: string
          legacy_transaction_id?: string | null
          notes?: string | null
          recurring_transaction_id?: string | null
          status?: Database["public"]["Enums"]["finance_transaction_status"]
          transaction_date: string
          type: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          description?: string
          destination_account_id?: string | null
          id?: string
          legacy_transaction_id?: string | null
          notes?: string | null
          recurring_transaction_id?: string | null
          status?: Database["public"]["Enums"]["finance_transaction_status"]
          transaction_date?: string
          type?: Database["public"]["Enums"]["finance_transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_user_id_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_user_id_fkey"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_transactions_destination_account_id_user_id_fkey"
            columns: ["destination_account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "finance_transactions_recurring_transaction_id_user_id_fkey"
            columns: ["recurring_transaction_id", "user_id"]
            isOneToOne: false
            referencedRelation: "finance_recurring_transactions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      goals: {
        Row: {
          archived_at: string | null
          area: string
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          status: Database["public"]["Enums"]["goal_status"]
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          area: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          area?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      health_logs: {
        Row: {
          anxiety: number | null
          archived_at: string | null
          created_at: string
          energy: number | null
          id: string
          log_date: string
          meditation_minutes: number | null
          mood: number | null
          movement_minutes: number | null
          notes: string | null
          sleep_hours: number | null
          training_minutes: number | null
          updated_at: string
          user_id: string
          water_liters: number | null
          weight_kg: number | null
          workout_completed: boolean
        }
        Insert: {
          anxiety?: number | null
          archived_at?: string | null
          created_at?: string
          energy?: number | null
          id?: string
          log_date: string
          meditation_minutes?: number | null
          mood?: number | null
          movement_minutes?: number | null
          notes?: string | null
          sleep_hours?: number | null
          training_minutes?: number | null
          updated_at?: string
          user_id: string
          water_liters?: number | null
          weight_kg?: number | null
          workout_completed?: boolean
        }
        Update: {
          anxiety?: number | null
          archived_at?: string | null
          created_at?: string
          energy?: number | null
          id?: string
          log_date?: string
          meditation_minutes?: number | null
          mood?: number | null
          movement_minutes?: number | null
          notes?: string | null
          sleep_hours?: number | null
          training_minutes?: number | null
          updated_at?: string
          user_id?: string
          water_liters?: number | null
          weight_kg?: number | null
          workout_completed?: boolean
        }
        Relationships: []
      }
      ideas: {
        Row: {
          archived_at: string | null
          area: string
          created_at: string
          description: string | null
          goal_id: string | null
          id: string
          idea_date: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          area: string
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          idea_date?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          area?: string
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          idea_date?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ideas_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          archived_at: string | null
          area: string | null
          content: string
          created_at: string
          entry_date: string
          gratitude: string | null
          id: string
          lesson: string | null
          mood: number | null
          tags: string[]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          area?: string | null
          content: string
          created_at?: string
          entry_date: string
          gratitude?: string | null
          id?: string
          lesson?: string | null
          mood?: number | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          area?: string | null
          content?: string
          created_at?: string
          entry_date?: string
          gratitude?: string | null
          id?: string
          lesson?: string | null
          mood?: number | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      portfolio_assets: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          sort_order: number
          type: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          sort_order?: number
          type?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          type?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_assets_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "portfolio_projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      portfolio_case_studies: {
        Row: {
          context: string | null
          created_at: string
          id: string
          learnings: string | null
          metrics: string | null
          problem: string | null
          process: string | null
          project_id: string
          result: string | null
          sales_opportunity_id: string | null
          solution: string | null
          status: string
          testimonial: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          id?: string
          learnings?: string | null
          metrics?: string | null
          problem?: string | null
          process?: string | null
          project_id: string
          result?: string | null
          sales_opportunity_id?: string | null
          solution?: string | null
          status?: string
          testimonial?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: string | null
          created_at?: string
          id?: string
          learnings?: string | null
          metrics?: string | null
          problem?: string | null
          process?: string | null
          project_id?: string
          result?: string | null
          sales_opportunity_id?: string | null
          solution?: string | null
          status?: string
          testimonial?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_case_studies_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "portfolio_projects"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "portfolio_case_studies_sales_opportunity_id_fkey"
            columns: ["sales_opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_projects: {
        Row: {
          client: string | null
          created_at: string
          description: string | null
          ends_on: string | null
          featured: boolean
          id: string
          impact: string | null
          links: Json
          problem: string | null
          role: string | null
          solution: string | null
          starts_on: string | null
          status: string
          technologies: string[]
          title: string
          updated_at: string
          user_id: string
          visibility: string
          workspace_id: string | null
        }
        Insert: {
          client?: string | null
          created_at?: string
          description?: string | null
          ends_on?: string | null
          featured?: boolean
          id?: string
          impact?: string | null
          links?: Json
          problem?: string | null
          role?: string | null
          solution?: string | null
          starts_on?: string | null
          status?: string
          technologies?: string[]
          title: string
          updated_at?: string
          user_id: string
          visibility?: string
          workspace_id?: string | null
        }
        Update: {
          client?: string | null
          created_at?: string
          description?: string | null
          ends_on?: string | null
          featured?: boolean
          id?: string
          impact?: string | null
          links?: Json
          problem?: string | null
          role?: string | null
          solution?: string | null
          starts_on?: string | null
          status?: string
          technologies?: string[]
          title?: string
          updated_at?: string
          user_id?: string
          visibility?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_testimonials: {
        Row: {
          author: string
          created_at: string
          id: string
          project_id: string
          quote: string
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author: string
          created_at?: string
          id?: string
          project_id: string
          quote: string
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          project_id?: string
          quote?: string
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_testimonials_project_id_user_id_fkey"
            columns: ["project_id", "user_id"]
            isOneToOne: false
            referencedRelation: "portfolio_projects"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived_at: string | null
          area: string
          completed_at: string | null
          created_at: string
          description: string | null
          goal_id: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          area: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          area?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_activities: {
        Row: {
          completed: boolean
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          opportunity_id: string
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          opportunity_id: string
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string
          task_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_activities_opportunity_id_user_id_fkey"
            columns: ["opportunity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "sales_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_leads: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_opportunities: {
        Row: {
          client: string
          company: string | null
          created_at: string
          estimated_value: number
          follow_up_date: string | null
          id: string
          lead_id: string | null
          next_action: string | null
          notes: string | null
          probability: number | null
          service: string
          sort_order: number
          stage: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          client: string
          company?: string | null
          created_at?: string
          estimated_value?: number
          follow_up_date?: string | null
          id?: string
          lead_id?: string | null
          next_action?: string | null
          notes?: string | null
          probability?: number | null
          service: string
          sort_order?: number
          stage?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          client?: string
          company?: string | null
          created_at?: string
          estimated_value?: number
          follow_up_date?: string | null
          id?: string
          lead_id?: string | null
          next_action?: string | null
          notes?: string | null
          probability?: number | null
          service?: string
          sort_order?: number
          stage?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sales_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_proposals: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          opportunity_id: string
          portfolio_project_id: string | null
          sent_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_id: string
          portfolio_project_id?: string | null
          sent_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_id?: string
          portfolio_project_id?: string | null
          sent_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_proposals_opportunity_id_user_id_fkey"
            columns: ["opportunity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sprint_outcomes: {
        Row: {
          created_at: string
          id: string
          sort_order: number
          sprint_id: string
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sort_order?: number
          sprint_id: string
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sort_order?: number
          sprint_id?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_outcomes_sprint_id_user_id_fkey"
            columns: ["sprint_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sprint_reviews: {
        Row: {
          blockers: string | null
          carry_over_notes: string | null
          created_at: string
          id: string
          lessons: string | null
          sprint_id: string
          summary: string | null
          updated_at: string
          user_id: string
          wins: string | null
        }
        Insert: {
          blockers?: string | null
          carry_over_notes?: string | null
          created_at?: string
          id?: string
          lessons?: string | null
          sprint_id: string
          summary?: string | null
          updated_at?: string
          user_id: string
          wins?: string | null
        }
        Update: {
          blockers?: string | null
          carry_over_notes?: string | null
          created_at?: string
          id?: string
          lessons?: string | null
          sprint_id?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
          wins?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sprint_reviews_sprint_id_user_id_fkey"
            columns: ["sprint_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sprint_tasks: {
        Row: {
          added_at: string
          commitment_type: string
          completed_in_sprint: boolean
          created_at: string
          id: string
          removed_at: string | null
          sprint_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          commitment_type?: string
          completed_in_sprint?: boolean
          created_at?: string
          id?: string
          removed_at?: string | null
          sprint_id: string
          task_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          commitment_type?: string
          completed_in_sprint?: boolean
          created_at?: string
          id?: string
          removed_at?: string | null
          sprint_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_tasks_sprint_id_user_id_fkey"
            columns: ["sprint_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "sprint_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          capacity_minutes: number | null
          created_at: string
          end_date: string
          id: string
          main_outcome: string
          name: string
          notes: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          capacity_minutes?: number | null
          created_at?: string
          end_date: string
          id?: string
          main_outcome: string
          name: string
          notes?: string | null
          start_date: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          capacity_minutes?: number | null
          created_at?: string
          end_date?: string
          id?: string
          main_outcome?: string
          name?: string
          notes?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      study_sessions: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          minutes: number
          notes: string | null
          occurred_at: string
          skill: string
          topic: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          minutes: number
          notes?: string | null
          occurred_at?: string
          skill: string
          topic: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          minutes?: number
          notes?: string | null
          occurred_at?: string
          skill?: string
          topic?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          area: string
          blocker_reason: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          estimated_minutes: number | null
          goal_id: string | null
          id: string
          notes: string | null
          paused_until: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          sort_order: number
          stakeholder: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
          waiting_for: string | null
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          area: string
          blocker_reason?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          goal_id?: string | null
          id?: string
          notes?: string | null
          paused_until?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          sort_order?: number
          stakeholder?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
          waiting_for?: string | null
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          area?: string
          blocker_reason?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          goal_id?: string | null
          id?: string
          notes?: string | null
          paused_until?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          sort_order?: number
          stakeholder?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
          waiting_for?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          archived_at: string | null
          category: string
          created_at: string
          description: string
          id: string
          kind: string
          occurred_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          archived_at?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          kind: string
          occurred_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          archived_at?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          kind?: string
          occurred_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      travel_budget_items: {
        Row: {
          budgeted: number
          category: string
          created_at: string
          description: string
          finance_transaction_id: string | null
          id: string
          paid: number
          reserved: number
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          budgeted?: number
          category: string
          created_at?: string
          description: string
          finance_transaction_id?: string | null
          id?: string
          paid?: number
          reserved?: number
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          budgeted?: number
          category?: string
          created_at?: string
          description?: string
          finance_transaction_id?: string | null
          id?: string
          paid?: number
          reserved?: number
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_budget_items_finance_transaction_id_fkey"
            columns: ["finance_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_budget_items_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_checklist_items: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          section: string
          sort_order: number
          title: string
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          section: string
          sort_order?: number
          title: string
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          section?: string
          sort_order?: number
          title?: string
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_checklist_items_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_destinations: {
        Row: {
          arrival_date: string | null
          city: string
          country: string
          created_at: string
          departure_date: string | null
          id: string
          latitude: number | null
          longitude: number | null
          nights: number | null
          notes: string | null
          sort_order: number
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arrival_date?: string | null
          city: string
          country: string
          created_at?: string
          departure_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nights?: number | null
          notes?: string | null
          sort_order?: number
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arrival_date?: string | null
          city?: string
          country?: string
          created_at?: string
          departure_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nights?: number | null
          notes?: string | null
          sort_order?: number
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_destinations_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_documents: {
        Row: {
          created_at: string
          expires_on: string | null
          id: string
          name: string
          notes: string | null
          reference: string | null
          trip_id: string
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_on?: string | null
          id?: string
          name: string
          notes?: string | null
          reference?: string | null
          trip_id: string
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_on?: string | null
          id?: string
          name?: string
          notes?: string | null
          reference?: string | null
          trip_id?: string
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_documents_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_goals: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          sort_order: number
          title: string
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_goals_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_itinerary_items: {
        Row: {
          cost: number
          created_at: string
          duration_minutes: number | null
          id: string
          location: string | null
          notes: string | null
          reservation_id: string | null
          sort_order: number
          starts_at: string
          status: string
          title: string
          trip_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cost?: number
          created_at?: string
          duration_minutes?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          reservation_id?: string | null
          sort_order?: number
          starts_at: string
          status?: string
          title: string
          trip_id: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          duration_minutes?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          reservation_id?: string | null
          sort_order?: number
          starts_at?: string
          status?: string
          title?: string
          trip_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_itinerary_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "travel_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_itinerary_items_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          title: string
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          title: string
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          title?: string
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_notes_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_reservations: {
        Row: {
          amount: number
          confirmation: string | null
          created_at: string
          document_id: string | null
          id: string
          link: string | null
          notes: string | null
          provider: string
          reservation_date: string | null
          status: string
          trip_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          confirmation?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          link?: string | null
          notes?: string | null
          provider: string
          reservation_date?: string | null
          status?: string
          trip_id: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          confirmation?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          link?: string | null
          notes?: string | null
          provider?: string
          reservation_date?: string | null
          status?: string
          trip_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_reservations_trip_id_user_id_fkey"
            columns: ["trip_id", "user_id"]
            isOneToOne: false
            referencedRelation: "travel_trips"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      travel_trips: {
        Row: {
          archived_at: string | null
          budget_total: number
          cover_image_url: string | null
          created_at: string
          currency: string
          description: string | null
          end_date: string | null
          id: string
          name: string
          origin: string | null
          start_date: string | null
          status: string
          travel_style: string | null
          travelers: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          budget_total?: number
          cover_image_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          origin?: string | null
          start_date?: string | null
          status?: string
          travel_style?: string | null
          travelers?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          budget_total?: number
          cover_image_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          origin?: string | null
          start_date?: string | null
          status?: string
          travel_style?: string | null
          travelers?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      treatment_logs: {
        Row: {
          archived_at: string | null
          created_at: string
          dosage_text: string | null
          dose_mg: number | null
          dryness_level: number | null
          id: string
          log_date: string
          medication_taken: boolean
          notes: string | null
          side_effects: string[]
          skin_condition: string | null
          skin_status: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          dosage_text?: string | null
          dose_mg?: number | null
          dryness_level?: number | null
          id?: string
          log_date: string
          medication_taken?: boolean
          notes?: string | null
          side_effects?: string[]
          skin_condition?: string | null
          skin_status?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          dosage_text?: string | null
          dose_mg?: number | null
          dryness_level?: number | null
          id?: string
          log_date?: string
          medication_taken?: boolean
          notes?: string | null
          side_effects?: string[]
          skin_condition?: string | null
          skin_status?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      voice_action_logs: {
        Row: {
          completed_at: string | null
          confirmation_required: boolean
          confirmation_status: string | null
          created_at: string
          entities: Json
          error_message: string | null
          id: string
          parsed_intent: string | null
          questions: Json
          request_id: string
          result: Json | null
          source: string
          status: string
          tool_arguments: Json | null
          tool_name: string | null
          transcript: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmation_required?: boolean
          confirmation_status?: string | null
          created_at?: string
          entities?: Json
          error_message?: string | null
          id?: string
          parsed_intent?: string | null
          questions?: Json
          request_id: string
          result?: Json | null
          source: string
          status: string
          tool_arguments?: Json | null
          tool_name?: string | null
          transcript?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmation_required?: boolean
          confirmation_status?: string | null
          created_at?: string
          entities?: Json
          error_message?: string | null
          id?: string
          parsed_intent?: string | null
          questions?: Json
          request_id?: string
          result?: Json | null
          source?: string
          status?: string
          tool_arguments?: Json | null
          tool_name?: string | null
          transcript?: string | null
          user_id?: string
        }
        Relationships: []
      }
      voice_preferences: {
        Row: {
          aliases: Json
          language: string
          updated_at: string
          user_id: string
          voice: string
        }
        Insert: {
          aliases?: Json
          language?: string
          updated_at?: string
          user_id: string
          voice?: string
        }
        Update: {
          aliases?: Json
          language?: string
          updated_at?: string
          user_id?: string
          voice?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_finance_transaction_safely: {
        Args: { target_transaction_id: string }
        Returns: undefined
      }
      finance_next_recurring_date: {
        Args: {
          current_date_value: string
          frequency_value: Database["public"]["Enums"]["finance_frequency"]
        }
        Returns: string
      }
      register_finance_goal_contribution: {
        Args: {
          target_account_id?: string
          target_amount: number
          target_date: string
          target_description?: string
          target_goal_id: string
          target_notes?: string
          target_source: string
        }
        Returns: string
      }
      register_finance_recurring_occurrence: {
        Args: {
          target_expected_date: string
          target_period: string
          target_recurring_id: string
        }
        Returns: string
      }
      revert_finance_recurring_occurrence: {
        Args: { target_occurrence_id: string }
        Returns: undefined
      }
      seed_finance_categories: {
        Args: { target_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      finance_account_type:
        | "cash"
        | "checking"
        | "savings"
        | "credit"
        | "investment"
        | "loan"
      finance_category_type:
        | "income"
        | "expense"
        | "saving"
        | "debt"
        | "transfer"
      finance_frequency:
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "yearly"
      finance_goal_priority: "low" | "medium" | "high" | "critical"
      finance_goal_status: "active" | "paused" | "completed" | "cancelled"
      finance_recurring_occurrence_status:
        | "pending"
        | "paid"
        | "skipped"
        | "postponed"
      finance_transaction_status:
        | "planned"
        | "pending"
        | "completed"
        | "cancelled"
      finance_transaction_type:
        | "income"
        | "expense"
        | "transfer"
        | "saving"
        | "debt_payment"
        | "refund"
      goal_status: "active" | "paused" | "completed"
      project_status: "idea" | "planned" | "active" | "paused" | "completed"
      task_priority: "low" | "medium" | "high" | "critical"
      task_status: "inbox" | "todo" | "doing" | "paused" | "blocked" | "done"
      workspace_type: "personal" | "employment" | "business" | "client"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      finance_account_type: [
        "cash",
        "checking",
        "savings",
        "credit",
        "investment",
        "loan",
      ],
      finance_category_type: [
        "income",
        "expense",
        "saving",
        "debt",
        "transfer",
      ],
      finance_frequency: [
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "yearly",
      ],
      finance_goal_priority: ["low", "medium", "high", "critical"],
      finance_goal_status: ["active", "paused", "completed", "cancelled"],
      finance_recurring_occurrence_status: [
        "pending",
        "paid",
        "skipped",
        "postponed",
      ],
      finance_transaction_status: [
        "planned",
        "pending",
        "completed",
        "cancelled",
      ],
      finance_transaction_type: [
        "income",
        "expense",
        "transfer",
        "saving",
        "debt_payment",
        "refund",
      ],
      goal_status: ["active", "paused", "completed"],
      project_status: ["idea", "planned", "active", "paused", "completed"],
      task_priority: ["low", "medium", "high", "critical"],
      task_status: ["inbox", "todo", "doing", "paused", "blocked", "done"],
      workspace_type: ["personal", "employment", "business", "client"],
    },
  },
} as const
