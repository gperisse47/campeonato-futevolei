"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Swords } from "lucide-react"

import { generateGroupsAction } from "@/app/actions"
import type { GenerateTournamentGroupsOutput } from "@/lib/types"
import { formSchema, type TournamentFormValues, type Team } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "./ui/skeleton"
import { Separator } from "./ui/separator"

export function GroupGenerator() {
  const [isLoading, setIsLoading] = useState(false)
  const [generatedGroups, setGeneratedGroups] = useState<GenerateTournamentGroupsOutput | null>(null)
  const { toast } = useToast()

  const form = useForm<TournamentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "Masculino",
      numberOfTeams: 8,
      numberOfGroups: 2,
      teams: "Ana/Bia, Carla/Dani, Elena/Fernanda, Gabi/Helo, Isis/Julia, Karla/Laura, Maria/Nina, Olivia/Paula",
      groupFormationStrategy: "balanced",
    },
  })

  async function onSubmit(values: TournamentFormValues) {
    setIsLoading(true)
    setGeneratedGroups(null)

    const teamsArray: Team[] = values.teams
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((teamString) => {
        const players = teamString.split("/").map((p) => p.trim());
        return { player1: players[0], player2: players[1] };
      });

    const result = await generateGroupsAction({
      ...values,
      teams: teamsArray,
    })

    if (result.success && result.data) {
      setGeneratedGroups(result.data)
      toast({
        title: "Grupos e Jogos Gerados!",
        description: "Os grupos e confrontos estão prontos para visualização.",
      })
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Gerar",
        description: result.error || "Ocorreu um erro inesperado.",
      })
    }

    setIsLoading(false)
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Configurações do Torneio</CardTitle>
          <CardDescription>
            Insira os detalhes para a geração dos grupos e jogos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Masculino, Misto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="numberOfTeams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nº de Duplas</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="numberOfGroups"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nº de Grupos</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="teams"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duplas (Jogadores)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Separe duplas por vírgula e jogadores por barra. Ex: Jogador A/Jogador B, Jogador C/Jogador D"
                        className="min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Use o formato: Jogador1/Jogador2, Jogador3/Jogador4
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="groupFormationStrategy"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Estratégia de Formação</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="balanced" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Balanceado
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="random" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Aleatório (Sorteio)
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gerar Grupos e Jogos
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Card className="min-h-full">
          <CardHeader>
            <CardTitle>Grupos e Jogos Gerados</CardTitle>
            <CardDescription>
              Visualize os grupos e confrontos formados pela IA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(form.getValues("numberOfGroups"))].map((_, i) => (
                    <Card key={i}>
                        <CardHeader>
                            <Skeleton className="h-6 w-24" />
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-5/6" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-4/6" />
                        </CardContent>
                    </Card>
                ))}
              </div>
            )}
            {generatedGroups && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {generatedGroups.groups.map((group) => (
                  <Card key={group.name} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-primary">{group.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-4">
                      <div>
                        <h4 className="mb-2 font-semibold">Duplas</h4>
                        <ul className="space-y-2">
                          {group.teams.map((team, index) => (
                            <li key={`${team.player1}-${index}`} className="rounded-md bg-secondary/50 p-2 text-sm text-secondary-foreground">
                              {team.player1} / {team.player2}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Separator/>
                      <div>
                        <h4 className="mb-2 font-semibold">Jogos</h4>
                        <ul className="space-y-2">
                            {group.matches.map((match, index) => (
                                <li key={index} className="flex items-center justify-center gap-2 rounded-md bg-secondary/50 p-2 text-center text-sm text-secondary-foreground">
                                    <span>{match.team1.player1}/{match.team1.player2}</span>
                                    <Swords className="h-4 w-4 text-primary"/>
                                    <span>{match.team2.player1}/{match.team2.player2}</span>
                                </li>
                            ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {!isLoading && !generatedGroups && (
                <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full">
                    <p className="text-muted-foreground">Os grupos e jogos aparecerão aqui após a geração.</p>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
