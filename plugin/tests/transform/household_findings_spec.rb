# frozen_string_literal: true

# WHAT SIX INVENTED HOUSEHOLDS FOUND (test/households). Each case is one of
# them, cut down to the feed line that showed it: a custody week written with
# times, a night shift seen the morning after, clean-up rules that have to add
# up, a weekday rule asked about tomorrow, an Outlook zone name, and a rota
# that repeats a week-long all-day block.

require_relative '../support/transform'

RSpec.describe 'household-findings' do
  include Metro::Transform

  ics = lambda do |rows|
    (['BEGIN:VCALENDAR', 'VERSION:2.0'] + rows + ['END:VCALENDAR', '']).join("\r\n")
  end
  ev = lambda do |props|
    ['BEGIN:VEVENT', "UID:#{rand}@x"] + props + ['END:VEVENT']
  end
  define_method(:board) do |feed, now_iso, cal = nil, zone = nil|
    now = ms(now_iso)
    input = base_input(now, config_json: JSON.generate(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Sam' }.merge(cal || {})]
    ))
    input['trmnl']['user']['time_zone_iana'] = zone.to_s.empty? ? 'Europe/Brussels' : zone
    run_transform([otherwise(feed)], now, input)['data']
  end

  it 'a timed event of a day or more is a state at the head of the line, day by day' do
    feed = ics.(ev.(['SUMMARY:Kids at the other home', 'DTSTART;TZID=Europe/Brussels:20260911T180000',
                     'DTEND;TZID=Europe/Brussels:20260918T180000']))
    d = board(feed, '2026-09-15T06:00:00Z')
    assert_equal(event_items(d).select { /Kids/.match?(it['title'].to_s) }.length, 0, 'a week was drawn as a stop on the clock')
    heads = (d['all_day'] || []).select { /Kids/.match?(it['title'].to_s) && (it['day'] || 0) == 0 }
    assert_equal(heads.length, 1, 'the week is not at the head of the line on its fifth day')
  end

  it "a night shift that began yesterday is on this morning's board, and says when it began" do
    feed = ics.(ev.(['SUMMARY:Night shift', 'DTSTART:20260914T190000Z', 'DTEND:20260915T070000Z']))
    d = board(feed, '2026-09-15T05:00:00Z', {}, 'Europe/London')
    shift = event_items(d).select { it['title'] == 'Night shift' && !it['start_min'].nil? && it['start_min'] < 1440 }
    assert_equal(shift.length, 1, 'the shift is gone from the morning it is still running')
    assert_equal(shift[0]['start_min'], 0, 'it does not start the board at midnight')
    assert_equal(shift[0]['began_min'], -240, 'it does not say it began at 20:00 the evening before')
    assert_equal(shift[0]['end_min'], 480, 'it does not end at 08:00')
  end

  it 'clean-up rules add up: every matching rewrite cuts, in order' do
    feed = ics.(ev.(['SUMMARY:RE: [ACME-2231] Invitation : Design review', 'DTSTART;TZID=Europe/Brussels:20260915T100000',
                     'DTEND;TZID=Europe/Brussels:20260915T110000']))
    d = board(feed, '2026-09-15T06:00:00Z', { rules: [
      { match: { type: 'regex', value: '^RE:\\s*' }, rewrite: '' },
      { match: { type: 'regex', value: '\\[[A-Z]+-\\d+\\]\\s*' }, rewrite: '' },
      { match: { type: 'contains', value: 'Invitation :' }, rewrite: '' }
    ] })
    assert_equal(event_items(d).map { it['title'] }, ['Design review'], 'only some of the rewrites were applied')
  end

  it 'a title that began with a capital keeps one after its prefix is cut' do
    feed = ics.(ev.(['SUMMARY:Mia logo', 'DTSTART;TZID=Europe/Brussels:20260915T160000', 'DTEND;TZID=Europe/Brussels:20260915T163000']))
    d = board(feed, '2026-09-15T06:00:00Z', { rules: [{ match: { type: 'regex', value: '^Mia\\s+' }, rewrite: '' }] })
    assert_equal(event_items(d).map { it['title'] }, ['Logo'], 'the cut left a lower-case title')
  end

  it 'a weekday rule asks the weekday of the event, not of today' do
    feed = ics.(ev.(['SUMMARY:Office block', 'DTSTART;TZID=Europe/Brussels:20260916T090000',
                     'DTEND;TZID=Europe/Brussels:20260916T100000']))
    d = board(feed, '2026-09-15T19:30:00Z', { rules: [
      { match: { type: 'and', matchers: [{ type: 'weekday', value: ['WE'] }, { type: 'contains', value: 'Office' }] }, title: 'Wednesday office' }
    ] })
    tomorrow = event_items(d).select { !it['start_min'].nil? && it['start_min'] >= 1440 }
    assert_equal(tomorrow.map { it['title'] }, ['Wednesday office'], "Wednesday's event was judged as a Tuesday")
  end

  it 'an Outlook zone name is read as the zone it names' do
    feed = ics.(ev.(['SUMMARY:London sync', 'DTSTART;TZID=GMT Standard Time:20260915T133000',
                     'DTEND;TZID=GMT Standard Time:20260915T143000']))
    d = board(feed, '2026-09-15T06:00:00Z', {}, 'Europe/Paris')
    assert_equal(event_items(d).map { it['start_min'] }, [14 * 60 + 30], '13:30 in London is not 14:30 in Paris')
  end

  it 'a week-long all-day block repeating every four weeks comes back' do
    feed = ics.(ev.(['SUMMARY:Kitchen duty', 'DTSTART;VALUE=DATE:20260720', 'DTEND;VALUE=DATE:20260727',
                     'RRULE:FREQ=WEEKLY;INTERVAL=4']))
    d = board(feed, '2026-09-16T06:00:00Z') # 14-20 Sep is a duty week; Wed is day 3
    heads = (d['all_day'] || []).select { it['title'] == 'Kitchen duty' && (it['day'] || 0) == 0 }
    assert_equal(heads.length, 1, 'the repeating week is missing')
  end
end
