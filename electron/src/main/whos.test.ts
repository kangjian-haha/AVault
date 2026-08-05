import { describe, expect, it } from 'vitest'
import { parseWhosActorDetails } from './whos'

describe('Whos.tv actor parser', () => {
  it('parses structured actor data and visible profile fields', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Person","name":"桃乃木かな","alternateName":["桃乃木香奈"],"image":"https://img.example/avatar.png","birthDate":"1996-12-24","height":"153 cm"}</script>
      <h1>桃乃木かな</h1>
      <button onclick="showRating('311', '桃乃木かな')"></button>
      <div><p class="text-sm text-muted-foreground">三围</p><p class="font-medium">B80 W54 H80</p></div>
      <div><p class="text-sm text-muted-foreground">出道年份</p><p class="font-medium">2015部</p></div>`
    expect(parseWhosActorDetails('https://whos.tv/actresses/test', html)).toMatchObject({
      name: '桃乃木かな', providerId: '311', whosId: '311', aliases: ['桃乃木香奈'],
      avatarUrl: 'https://img.example/avatar.png', birthday: '1996-12-24', height: 153,
      bust: 80, waist: 54, hip: 80, debutYear: 2015, metadataSource: 'whos'
    })
  })

  it('rejects implausible measurements instead of saving bad data', () => {
    const html = `<script type="application/ld+json">{"@type":"Person","name":"测试演员","height":"153 cm"}</script><div><p class="text-sm text-muted-foreground">三围</p><p class="font-medium">B21 W31 H31</p></div>`
    expect(parseWhosActorDetails('https://whos.tv/actresses/test', html)).toMatchObject({ bust: null, waist: null, hip: null })
  })
})
