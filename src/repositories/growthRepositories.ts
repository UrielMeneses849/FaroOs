import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'

type Tables = Database['public']['Tables']
type TableName = 'travel_trips' | 'travel_destinations' | 'travel_goals' | 'travel_itinerary_items' |
  'travel_reservations' | 'travel_budget_items' | 'travel_checklist_items' | 'travel_documents' |
  'travel_notes' | 'sales_leads' | 'sales_opportunities' | 'sales_activities' | 'sales_proposals' |
  'content_channels' | 'content_campaigns' | 'content_items' | 'portfolio_projects' |
  'portfolio_case_studies' | 'portfolio_assets' | 'portfolio_testimonials'

function repository<T extends TableName>(table: T) {
  // The generated Supabase query builder cannot preserve a generic table union;
  // callers still receive exact generated Row/Insert/Update types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any
  return {
    async list(userId: string): Promise<Tables[T]['Row'][]> {
      const { data, error } = await client.from(table).select('*').eq('user_id', userId)
      if (error) throw error
      return data as Tables[T]['Row'][]
    },
    async save(input: Tables[T]['Insert'], userId: string): Promise<Tables[T]['Row']> {
      const { data, error } = await client.from(table).upsert({ ...input, user_id: userId }).select().single()
      if (error) throw error
      return data as Tables[T]['Row']
    },
    async update(id: string, input: Tables[T]['Update'], userId: string): Promise<Tables[T]['Row']> {
      const { data, error } = await client.from(table).update(input).eq('id', id).eq('user_id', userId).select().single()
      if (error) throw error
      return data as Tables[T]['Row']
    },
    async remove(id: string, userId: string) {
      const { error } = await client.from(table).delete().eq('id', id).eq('user_id', userId)
      if (error) throw error
    },
  }
}

export const travelTripRepository = repository('travel_trips')
export const travelDestinationRepository = repository('travel_destinations')
export const travelGoalRepository = repository('travel_goals')
export const travelItineraryRepository = repository('travel_itinerary_items')
export const travelReservationRepository = repository('travel_reservations')
export const travelBudgetRepository = repository('travel_budget_items')
export const travelChecklistRepository = repository('travel_checklist_items')
export const travelDocumentRepository = repository('travel_documents')
export const travelNoteRepository = repository('travel_notes')
export const salesLeadRepository = repository('sales_leads')
export const salesOpportunityRepository = repository('sales_opportunities')
export const salesActivityRepository = repository('sales_activities')
export const salesProposalRepository = repository('sales_proposals')
export const contentChannelRepository = repository('content_channels')
export const contentCampaignRepository = repository('content_campaigns')
export const contentItemRepository = repository('content_items')
export const portfolioProjectRepository = repository('portfolio_projects')
export const portfolioCaseStudyRepository = repository('portfolio_case_studies')
export const portfolioAssetRepository = repository('portfolio_assets')
export const portfolioTestimonialRepository = repository('portfolio_testimonials')
