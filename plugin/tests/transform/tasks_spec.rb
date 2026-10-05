# frozen_string_literal: true

# WHAT IS OWED (rule 2q). A calendar can carry tasks as well as
# appointments, and they arrive in the same file: Nextcloud Tasks, a
# Todoist project feed, anything that syncs over CalDAV. A task due at a
# time today is a stop like any other; one with no time, and one still
# owed from an earlier day, is carried as a task instead, because the
# board looks forward and a stop in the past is not a thing to do.
# Done today it stays, ticked; done any earlier it is gone.

require_relative '../support/transform'

RSpec.describe 'tasks' do
  include Metro::Transform

  now = Time.iso8601('2026-09-15T08:00:00Z').to_i * 1000 # a Tuesday morning, Brussels
  todo = lambda do |summary, lines = nil|
    (['BEGIN:VTODO', "UID:#{summary}", 'DTSTAMP:20260915T000000Z', "SUMMARY:#{summary}"] +
      (lines || []) + ['END:VTODO']).join("\r\n")
  end
  feed = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + [
    todo.call('Mow the lawn'),                                                   # no due date at all
    todo.call('Bins out', ['DUE:20260915T170000Z']),                            # due later today
    todo.call('Library books', ['DUE:20260914T170000Z']),                       # still owed from yesterday
    todo.call('Homework', ['DUE:20260915T060000Z', 'STATUS:COMPLETED', 'COMPLETED:20260915T063000Z']),
    todo.call('Old chore', ['DUE:20260914T060000Z', 'STATUS:COMPLETED', 'COMPLETED:20260914T070000Z']),
    todo.call('Never mind', ['STATUS:CANCELLED'])
  ].join("\r\n") + "\r\nEND:VCALENDAR\r\n"

  define_method(:board) do |extra = nil|
    i = base_input(now, { config_json: JSON.generate(
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/tasks.ics', name: 'Alex' }]
    ) }.merge(extra || {}))
    i['trmnl']['user']['time_zone_iana'] = 'Europe/Brussels'
    run_transform([otherwise(feed)], now, i)['data']
  end

  it 'a task with a time is a stop; one without, and one still owed, are tasks' do
    d = board
    stops = d['events'].select { |e| e['todo'] }.map { |e| e['title'] }.sort
    owed = (d['tasks'] || []).map do |t|
      t['title'] + (t['done'] ? ' (done)' : '') + (t['overdue'] ? ' (overdue)' : '')
    end.sort
    assert(stops.join(',') == 'Bins out,Homework', "the stops: #{stops.join(',')}")
    assert(owed.join(' | ') == 'Library books (overdue) | Mow the lawn', "what is owed: #{owed.join(' | ')}")
    # done today keeps its stop and says so; done yesterday is gone; cancelled never was
    done = d['events'].select { |e| e['todo'] && e['done'] }.map { |e| e['title'] }
    assert(done.join(',') == 'Homework', "ticked stops: #{done.join(',')}")
    assert(!d['events'].any? { |e| /Old chore|Never mind/.match?(e['title'].to_s) },
           'a finished or cancelled task came back')
    assert(!(d['tasks'] || []).any? { |t| /Old chore|Never mind/.match?(t['title'].to_s) },
           'a finished or cancelled task is owed')
    # every task knows whose it is
    assert((d['tasks'] || []).all? { |t| (t['owners'] || []).length == 1 },
           "a task with no owner: #{d['tasks'].to_json}")
  end

  it 'the setting takes them off the board, and says how many wait at each end' do
    off = board(tasks_count: 'hide')
    assert((off['tasks'] || []).empty?, "tasks with the setting off: #{off['tasks'].to_json}")
    # two each by default, one each when asked
    two = board
    assert(two['tasks'].length == 2, "by default: #{two['tasks'].map { |t| t['title'] }.to_json}")
    one = board(tasks_count: '1')
    assert(one['tasks'].length == 1 && one['tasks'][0]['title'] == 'Library books',
           "one each: #{one['tasks'].map { |t| t['title'] }.to_json}")
  end
end
